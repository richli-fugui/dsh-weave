import { ValidationError } from '../shared/errors.js';
export class LocalProvider {
    domain;
    scheduler;
    contextManager;
    hostTracker;
    constructor(domain, scheduler, contextManager, hostTracker) {
        this.domain = domain;
        this.scheduler = scheduler;
        this.contextManager = contextManager;
        this.hostTracker = hostTracker;
    }
    async createWorkIntent(rawInput, projectId) {
        return this.domain.createWorkIntent(rawInput, projectId);
    }
    async getControlSnapshot() {
        let snapshot = this.scheduler
            ? this.scheduler.getControlSnapshot()
            : { activeCount: 0, queuedCount: 0, awaitingCount: 0, unknownCount: 0, items: [] };
        if (this.hostTracker) {
            snapshot = this.hostTracker.augmentControlSnapshot(snapshot);
        }
        return snapshot;
    }
    async stopRun(runId) {
        if (this.hostTracker && this.hostTracker.isHostSession(runId)) {
            return this.hostTracker.stopHostSession(runId);
        }
        if (this.scheduler) {
            return this.scheduler.stopRun(runId);
        }
        return { commandId: 'noop', status: 'already_terminal', stoppedRunIds: [] };
    }
    async stopIntent(intentId) {
        const [hostStop, schedStop] = await Promise.all([
            this.hostTracker?.stopIntent(intentId) ?? null, this.scheduler?.stopIntent(intentId) ?? null,
        ]);
        const commandId = schedStop?.commandId || hostStop?.commandId || 'noop';
        const status = schedStop?.status === 'conflict' || hostStop?.status === 'conflict' ? 'conflict' :
            schedStop?.status === 'waiting_tool_exit' || hostStop?.status === 'waiting_tool_exit'
                ? 'waiting_tool_exit'
                : schedStop?.status === 'stopped' || hostStop?.status === 'stopped'
                    ? 'stopped'
                    : 'already_terminal';
        const stoppedRunIds = [...(schedStop?.stoppedRunIds || []), ...(hostStop?.stoppedRunIds || [])];
        const pendingToolIds = [...(schedStop?.pendingToolIds || []), ...(hostStop?.pendingToolIds || [])];
        return {
            commandId,
            status,
            stoppedRunIds,
            pendingToolIds: pendingToolIds.length > 0 ? pendingToolIds : undefined,
        };
    }
    async stopAll() {
        const [hostStop, schedStop] = await Promise.all([
            this.hostTracker?.stopAll() ?? null, this.scheduler?.stopAll() ?? null,
        ]);
        const commandId = schedStop?.commandId || hostStop?.commandId || 'noop';
        const status = schedStop?.status === 'conflict' || hostStop?.status === 'conflict' ? 'conflict' :
            schedStop?.status === 'waiting_tool_exit' || hostStop?.status === 'waiting_tool_exit'
                ? 'waiting_tool_exit'
                : schedStop?.status === 'stopped' || hostStop?.status === 'stopped'
                    ? 'stopped'
                    : 'already_terminal';
        const stoppedRunIds = [...(schedStop?.stoppedRunIds || []), ...(hostStop?.stoppedRunIds || [])];
        const pendingToolIds = [...(schedStop?.pendingToolIds || []), ...(hostStop?.pendingToolIds || [])];
        return {
            commandId,
            status,
            stoppedRunIds,
            pendingToolIds: pendingToolIds.length > 0 ? pendingToolIds : undefined,
        };
    }
    async saveChatMessage(sender, text, intentId) {
        return this.domain.saveChatMessage(sender, text, intentId);
    }
    async listChatMessages() {
        return this.domain.listChatMessages(100);
    }
    async listProjects() {
        return this.domain.listProjects();
    }
    async getProject(id) {
        return this.domain.getProject(id);
    }
    async createProject(input) {
        return this.domain.createProject(input);
    }
    async updateProject(input) {
        return this.domain.updateProject(input);
    }
    async listTasks(projectId) {
        return this.domain.listTasks(projectId);
    }
    async getTask(id) {
        return this.domain.getTask(id);
    }
    async createTask(input) {
        return this.domain.createTask(input);
    }
    async updateTask(input) {
        return this.domain.updateTask(input);
    }
    async startRun(input) {
        if (this.scheduler) {
            // Pre-fix releases persisted a task-suffixed key even for this single-task API.
            const previous = this.domain.getRunForRequest(input) ?? this.domain.getRunForRequest({ ...input, clientRequestId: input.clientRequestId + '-' + input.taskId });
            if (previous)
                return previous;
            const runs = await this.scheduler.dispatchBatch([input.taskId], input.clientRequestId, input.intentId, true);
            if (runs.length > 0) {
                return runs[0];
            }
            // 检查是否已进入排队队列（返回排队状态，绝不伪造已在运行的虚假记录）
            const queuedItem = this.scheduler.getQueuedItems().find((q) => q.taskId === input.taskId && q.clientRequestId === input.clientRequestId);
            if (queuedItem) {
                return {
                    id: queuedItem.id,
                    taskId: input.taskId,
                    clientRequestId: queuedItem.clientRequestId,
                    intentId: queuedItem.intentId,
                    state: 'queued',
                    startedAt: new Date().toISOString(),
                };
            }
            throw new ValidationError(`任务 [${input.taskId}] 当前无法调度启动（前置依赖尚未就绪或任务已处终态）`);
        }
        return this.domain.startRun(input);
    }
    async completeRun(input) {
        return this.domain.completeRun(input);
    }
    async getRun(id) {
        return this.domain.getRun(id);
    }
    async listRuns(taskId) {
        return this.domain.listRuns(taskId);
    }
    async getResult(id) {
        return this.domain.getResult(id);
    }
    async getAssistantState(stableId) {
        return this.domain.getAssistantState(stableId);
    }
    async rotateAssistantSession(stableId, newSessionId) {
        if (this.contextManager) {
            return this.contextManager.rotateSession(stableId, newSessionId);
        }
        return this.domain.rotateAssistantSession(stableId, newSessionId);
    }
    async listUncertain() {
        return {
            runs: this.domain.listUncertainRuns(),
            queue: this.domain.listUncertainQueue(),
        };
    }
    async reconcileRun(runId, resolution) {
        if (this.scheduler) {
            return this.scheduler.reconcileRun(runId, resolution);
        }
        return this.domain.reconcileUnknownRun(runId, resolution);
    }
    async reconcileQueue(queueId, action = 'cancel') {
        if (this.scheduler) {
            return this.scheduler.reconcileQueue(queueId, action);
        }
        return this.domain.reconcileUnknownQueue(queueId, action);
    }
    async autoReconcileWithWorker() {
        const before = this.hostTracker?.getPendingTurn();
        if (before)
            await this.hostTracker.reconcileOnStartup();
        const result = this.scheduler
            ? await this.scheduler.reconcileUncertainRuns()
            : { reconciled: [], stillUncertain: this.domain.listUncertainRuns().map(r => r.id) };
        const after = this.hostTracker?.getPendingTurn();
        if (before && !after)
            result.reconciled.push({ runId: before.sessionId, resolvedState: before.stopRequested ? 'interrupted' : 'completed' });
        if (after?.status === 'unknown')
            result.stillUncertain.push(after.sessionId);
        return result;
    }
    followEvents(afterSequence, callback) {
        let currentSeq = afterSequence;
        let active = true;
        const poll = () => {
            if (!active)
                return;
            try {
                const events = this.domain.listOutboxEvents(currentSeq, 50);
                for (const ev of events) {
                    if (!active)
                        break;
                    callback(ev);
                    currentSeq = Math.max(currentSeq, ev.sequence);
                }
            }
            catch (err) {
                console.error('[LocalProvider] Error polling outbox events:', err);
            }
            if (active) {
                timer = setTimeout(poll, 250);
                if (typeof timer?.unref === 'function')
                    timer.unref();
            }
        };
        let timer = setTimeout(poll, 100);
        if (typeof timer?.unref === 'function')
            timer.unref();
        return () => {
            active = false;
            clearTimeout(timer);
        };
    }
}
//# sourceMappingURL=local.js.map