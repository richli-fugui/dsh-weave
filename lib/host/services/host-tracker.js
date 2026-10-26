import { randomUUID } from 'node:crypto';
import { DshHostSessionBridge } from './host-session.js';
export class HostSessionTracker {
    domain;
    getBridge;
    activePendingTurn = null;
    trackingTimer = null;
    // Invalidates callbacks already suspended inside a host query at disposal or Stop.
    observationEpoch = 0;
    pollIntervalMs;
    maxTrackingMs;
    constructor(domain, getBridge, options = {}) {
        this.domain = domain;
        this.getBridge = getBridge;
        this.pollIntervalMs = options.pollIntervalMs ?? 1500;
        this.maxTrackingMs = options.maxTrackingMs ?? 600_000;
        const stored = domain.getAssistantState().memoryIndex?.pendingHostTurn;
        if (stored && ['running', 'awaiting_input', 'stopping', 'unknown', 'stopped', 'timeout'].includes(stored.status)) {
            // Older code persisted stopped before confirming exit. Retain it as uncertain work.
            this.activePendingTurn = ['stopped', 'timeout'].includes(stored.status)
                ? { ...stored, status: 'unknown', stopRequested: stored.status === 'stopped' || stored.stopRequested }
                : stored;
        }
    }
    store(turn) {
        // Do not acknowledge a lost control record if persistence fails.
        this.domain.savePendingHostTurn(turn ? { ...turn } : null);
        this.activePendingTurn = turn;
    }
    markUnknown() {
        if (this.activePendingTurn)
            this.store({ ...this.activePendingTurn, status: 'unknown' });
    }
    recordTurnUncertain(requestId) {
        if (this.activePendingTurn?.requestId === requestId)
            this.markUnknown();
    }
    recordInteraction(interaction) {
        if (!this.activePendingTurn || this.activePendingTurn.stopRequested)
            throw new Error('No active workbench turn');
        this.stopBackgroundTracking();
        this.store({ ...this.activePendingTurn, status: 'awaiting_input', lastQuestion: interaction.title, interaction });
    }
    interactionAnswered(id) {
        const turn = this.activePendingTurn;
        if (!turn || turn.interaction?.id !== id || turn.stopRequested)
            return;
        this.store({ ...turn, status: 'running', interaction: undefined });
        this.startBackgroundTracking(turn.sessionId, turn.baselineMaxSeq, turn.intentId);
    }
    abandonUnknown(expectedRequestId, confirmed, reason) {
        const turn = this.activePendingTurn;
        if (!turn || turn.requestId !== expectedRequestId || turn.status !== 'unknown' || confirmed !== true || !reason?.trim()) {
            throw new Error('必须明确确认原宿主已退出，并核对当前待核对轮次；未解除保护。');
        }
        this.stopBackgroundTracking();
        this.domain.abandonPendingHostTurn(expectedRequestId, reason);
        this.activePendingTurn = null;
        // Never reuse the abandoned host session for future prompts.
    }
    /** Reconnection reconciles existing work; it never replays a prompt or cancel command. */
    async reconcileOnStartup() {
        const turn = this.activePendingTurn;
        if (!turn)
            return;
        const epoch = this.observationEpoch;
        const bridge = this.getBridge();
        if (!bridge) {
            this.markUnknown();
            return;
        }
        try {
            const diag = await bridge.diagnose(turn.sessionId);
            if (!this.isCurrent(turn, epoch))
                return;
            if (diag.agentStatus === 'idle') {
                await this.collectIdle(bridge, turn, epoch);
            }
            else if (diag.agentStatus === 'running' || diag.agentStatus === 'awaiting_input') {
                this.store({ ...turn, status: turn.stopRequested ? 'stopping' : diag.agentStatus });
                this.startBackgroundTracking(turn.sessionId, turn.baselineMaxSeq, turn.intentId);
            }
            else {
                this.markUnknown();
            }
        }
        catch {
            if (this.isCurrent(turn, epoch))
                this.markUnknown();
        }
    }
    isCurrent(turn, epoch) {
        return epoch === this.observationEpoch && this.activePendingTurn?.requestId === turn.requestId;
    }
    recordTurnStarted(info) {
        if (this.activePendingTurn?.stopRequested || this.activePendingTurn?.status === 'unknown') {
            throw new Error('主助理前一轮仍在停止或待核对，请先核验原会话状态。');
        }
        this.stopBackgroundTracking();
        const turn = { ...info, startedAt: new Date().toISOString(), status: 'running' };
        this.store(turn);
        this.domain.appendOutboxEvent(info.intentId || info.sessionId, 'assistant.turn_started', {
            sessionId: info.sessionId, requestId: info.requestId, intentId: info.intentId,
        });
        return turn;
    }
    async recordTurnAwaitingInput(questionText, sessionId, requestId) {
        const turn = this.activePendingTurn;
        if (!turn || turn.stopRequested || (requestId && turn.requestId !== requestId))
            return;
        this.stopBackgroundTracking();
        this.store({ ...turn, status: 'awaiting_input', lastQuestion: questionText });
        this.domain.appendOutboxEvent(turn.intentId || turn.sessionId, 'assistant.awaiting_input', {
            sessionId: turn.sessionId, question: questionText,
        });
    }
    recordTurnCompleted(replyText, requestId) {
        const turn = this.activePendingTurn;
        // A collector returning after Stop cannot clear the outstanding stop observation.
        if (!turn || turn.stopRequested || (requestId && turn.requestId !== requestId))
            return;
        this.stopBackgroundTracking();
        this.domain.savePendingHostTurn(null, {
            entityId: turn.intentId || turn.sessionId, type: 'assistant.turn_completed',
            payload: { sessionId: turn.sessionId, replyText },
        });
        this.activePendingTurn = null;
    }
    async collectIdle(bridge, turn, epoch) {
        const events = await bridge.eventsOf(turn.sessionId);
        if (!this.isCurrent(turn, epoch))
            return;
        const text = DshHostSessionBridge.extractAssistantMessages(events).filter(m => m.seq > turn.baselineMaxSeq).at(-1)?.text;
        // Chat, outbox and removal of pending are one transaction, including after restart.
        this.domain.savePendingHostTurn(null, {
            entityId: turn.intentId || turn.sessionId,
            type: turn.stopRequested ? 'assistant.session_stopped' : 'assistant.late_reply',
            payload: { sessionId: turn.sessionId, text, settled: true }, text, intentId: turn.intentId,
        });
        this.activePendingTurn = null;
    }
    startBackgroundTracking(sessionId, baselineMaxSeq, intentId) {
        const turn = this.activePendingTurn;
        if (!turn || turn.sessionId !== sessionId)
            return;
        this.stopBackgroundTracking();
        const epoch = this.observationEpoch;
        const deadline = Date.now() + this.maxTrackingMs;
        const poll = async () => {
            if (!this.isCurrent(turn, epoch))
                return;
            if (Date.now() > deadline) {
                this.markUnknown();
                return;
            }
            const bridge = this.getBridge();
            try {
                if (!bridge)
                    throw new Error('host unavailable');
                const diag = await bridge.diagnose(sessionId);
                if (!this.isCurrent(turn, epoch))
                    return;
                if (diag.agentStatus === 'idle') {
                    await this.collectIdle(bridge, this.activePendingTurn, epoch);
                    return;
                }
                if (diag.agentStatus === 'awaiting_input' && !this.activePendingTurn.stopRequested) {
                    const events = await bridge.eventsOf(sessionId);
                    if (!this.isCurrent(turn, epoch))
                        return;
                    const text = DshHostSessionBridge.extractAssistantMessages(events)
                        .filter(m => m.seq > baselineMaxSeq).at(-1)?.text || '宿主助理等待你的输入或确认。';
                    const next = { ...this.activePendingTurn, status: 'awaiting_input', lastQuestion: text };
                    this.domain.savePendingHostTurn({ ...next }, {
                        entityId: intentId || sessionId, type: 'assistant.awaiting_input', payload: { sessionId, question: text }, text, intentId,
                    });
                    this.activePendingTurn = next;
                    return;
                }
                if (!['running', 'awaiting_input'].includes(String(diag.agentStatus)))
                    this.markUnknown();
            }
            catch {
                if (!this.isCurrent(turn, epoch))
                    return;
                this.markUnknown();
            }
            if (this.isCurrent(turn, epoch))
                this.schedule(poll);
        };
        this.schedule(poll);
    }
    schedule(callback) {
        this.trackingTimer = setTimeout(() => {
            void callback().catch(err => console.error('[HostSessionTracker] observation failed:', err));
        }, this.pollIntervalMs);
        this.trackingTimer.unref();
    }
    stopBackgroundTracking() {
        this.observationEpoch++;
        if (this.trackingTimer)
            clearTimeout(this.trackingTimer);
        this.trackingTimer = null;
    }
    getPendingTurn() { return this.activePendingTurn; }
    isHostSession(targetId) {
        return targetId === 'main-assistant' || !!this.activePendingTurn &&
            [this.activePendingTurn.sessionId, this.activePendingTurn.requestId].includes(targetId);
    }
    async stopHostSession(targetId, timeoutMs = 1500) {
        const commandId = randomUUID();
        const turn = this.activePendingTurn;
        if (!turn)
            return { commandId, status: 'already_terminal', stoppedRunIds: [] };
        if (targetId && !this.isHostSession(targetId))
            return { commandId, status: 'conflict', stoppedRunIds: [] };
        this.stopBackgroundTracking();
        const epoch = this.observationEpoch;
        this.store({ ...turn, status: 'stopping', stopRequested: true });
        const pending = { commandId, stoppedRunIds: [], pendingToolIds: [turn.sessionId] };
        const bridge = this.getBridge();
        if (!bridge) {
            this.markUnknown();
            return { ...pending, status: 'conflict' };
        }
        let accepted = false;
        try {
            accepted = await bridge.cancel(turn.sessionId);
        }
        catch { /* outcome remains uncertain */ }
        const deadline = Date.now() + Math.max(0, timeoutMs);
        do {
            if (!this.isCurrent(turn, epoch))
                return { ...pending, status: 'waiting_tool_exit' };
            try {
                const diag = await bridge.diagnose(turn.sessionId);
                if (!this.isCurrent(turn, epoch))
                    return { ...pending, status: 'waiting_tool_exit' };
                // Unresolved is not a terminal receipt. Only explicit idle proves exit.
                if (diag.agentStatus === 'idle') {
                    await this.collectIdle(bridge, this.activePendingTurn, epoch);
                    if (!this.activePendingTurn)
                        return { commandId, status: 'stopped', stoppedRunIds: [turn.sessionId] };
                }
                else if (!['running', 'awaiting_input'].includes(String(diag.agentStatus)))
                    this.markUnknown();
            }
            catch {
                if (this.isCurrent(turn, epoch))
                    this.markUnknown();
            }
            if (Date.now() >= deadline)
                break;
            await new Promise(resolve => setTimeout(resolve, Math.min(this.pollIntervalMs, deadline - Date.now())));
        } while (Date.now() <= deadline);
        if (this.isCurrent(turn, epoch))
            this.startBackgroundTracking(turn.sessionId, turn.baselineMaxSeq, turn.intentId);
        return { ...pending, status: accepted ? 'waiting_tool_exit' : 'conflict' };
    }
    async stopIntent(intentId, timeoutMs = 1500) {
        return this.activePendingTurn?.intentId === intentId ? this.stopHostSession(undefined, timeoutMs) : null;
    }
    async stopAll(timeoutMs = 1500) { return this.stopHostSession(undefined, timeoutMs); }
    augmentControlSnapshot(snapshot) {
        const turn = this.activePendingTurn;
        if (!turn)
            return snapshot;
        const state = turn.status === 'unknown' ? 'unknown' : turn.stopRequested ? 'stopping' :
            turn.status === 'awaiting_input' ? 'awaiting_input' : 'running';
        const title = state === 'unknown' ? '主助理状态待核对' : state === 'stopping' ? '主助理会话正在停止' :
            state === 'awaiting_input' ? '主助理提问: ' + (turn.lastQuestion?.replace(/\s+/g, ' ').slice(0, 30) || '等待用户输入') : '主助理会话推进中';
        return {
            ...snapshot,
            activeCount: snapshot.activeCount + (state === 'running' || state === 'stopping' ? 1 : 0),
            awaitingCount: snapshot.awaitingCount + (state === 'awaiting_input' ? 1 : 0),
            unknownCount: (snapshot.unknownCount ?? 0) + (state === 'unknown' ? 1 : 0),
            items: [{ runId: turn.sessionId, taskId: 'main-assistant', taskTitle: title, projectId: 'global', state, intentId: turn.intentId }, ...snapshot.items],
        };
    }
}
//# sourceMappingURL=host-tracker.js.map