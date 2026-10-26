import { randomUUID } from 'node:crypto';
/** rc.3 public scoped waterfalls: user-questions/request and approval/request. */
export class WorkbenchInteractions {
    tracker;
    live = new Map();
    constructor(ctx, tracker) {
        this.tracker = tracker;
        ctx.on?.('user-questions/request', (request, next) => this.capture('question', request, next), { prepend: true, global: true });
        ctx.on?.('approval/request', (request, next) => this.capture('approval', request, next), { prepend: true, global: true });
        ctx.on?.('dispose', () => {
            for (const item of [...this.live.values()])
                item.settle('cancelled', Object.assign(new Error('工作台已卸载'), { name: 'UserQuestionError', code: 'ASK_ABORTED' }));
        });
    }
    capture(kind, request, next) {
        const turn = this.tracker.getPendingTurn();
        // Only the exact workbench-owned root session is intercepted. Other app work goes to next().
        if (!turn || turn.stopRequested || request.agent?.id !== turn.sessionId)
            return next();
        const audit = request.agent?.session?.snapshotEvents?.().filter((event) => event.type === 'approval/asked').at(-1);
        const nativeId = kind === 'question' ? request.wait?.callId || request.callId : audit?.data?.id || request.callId;
        const id = kind + ':' + (nativeId || randomUUID());
        if (this.live.has(id))
            throw new Error('Duplicate live workbench interaction');
        const questions = kind === 'question' ? request.questions : undefined;
        if (kind === 'question' && (!Array.isArray(questions) || !questions.length))
            return next();
        const title = kind === 'question' ? questions.map((q) => q.question || q.header || q.id).join('\n') :
            '需要批准：' + String(request.toolName || '工具操作') + (request.reason ? '\n' + String(request.reason) : '');
        const value = { id, kind, title, questions, sessionId: turn.sessionId, turnId: turn.requestId, nativeId: nativeId || null };
        return new Promise((resolve, reject) => {
            let settled = false;
            const abort = () => settle('cancelled', Object.assign(new Error('原请求已取消或过期'), { name: 'UserQuestionError', code: 'ASK_ABORTED' }));
            const settle = (answer, error) => {
                if (settled)
                    return;
                settled = true;
                this.live.delete(id);
                request.signal?.removeEventListener('abort', abort);
                this.tracker.interactionAnswered(id);
                if (error && kind === 'question')
                    reject(error);
                else
                    resolve(answer);
            };
            this.live.set(id, { value, turnId: turn.requestId, settle });
            try {
                this.tracker.recordInteraction(value);
            }
            catch (error) {
                this.live.delete(id);
                reject(error);
                return;
            }
            request.signal?.addEventListener('abort', abort, { once: true });
            if (request.signal?.aborted)
                abort();
        });
    }
    pending() { return [...this.live.values()].map(item => item.value); }
    respond(input) {
        const item = this.live.get(input?.id);
        const turn = this.tracker.getPendingTurn();
        if (!item || !turn || turn.stopRequested || item.turnId !== turn.requestId || input.sessionId !== turn.sessionId || input.turnId !== turn.requestId) {
            throw new Error('请求已过期、已作答或所属轮次已变化；未发送新的聊天。');
        }
        if (item.value.kind === 'approval') {
            if (!['approve', 'reject'].includes(input.action))
                throw new Error('必须明确选择批准或拒绝');
            item.settle(input.action === 'approve' ? 'allowed-once' : 'rejected');
        }
        else {
            const questions = item.value.questions;
            const answers = input.answers;
            if (!Array.isArray(answers) || answers.length !== questions.length || new Set(answers.map(a => a.id)).size !== questions.length ||
                !questions.every(q => answers.some(a => a.id === q.id && Array.isArray(a.selected) && a.selected.every((s) => typeof s === 'string' && q.options?.some((o) => o.label === s)) &&
                    (a.custom === undefined || typeof a.custom === 'string') && (a.selected.length || a.custom?.trim()))))
                throw new Error('请逐项回答所有问题，并使用原选项或补充文字');
            item.settle({ answers });
        }
    }
    respondText(text) {
        const pending = this.pending();
        if (pending.length !== 1)
            throw new Error('请在问题卡中选择要回答的原请求');
        const item = pending[0];
        if (item.kind === 'approval') {
            const action = /^(批准|同意|允许)$/.test(text) ? 'approve' : /^(拒绝|不同意|不允许)$/.test(text) ? 'reject' : null;
            if (!action)
                throw new Error('请明确选择批准或拒绝；未执行该工具');
            this.respond({ ...item, action });
        }
        else {
            if (item.questions.length !== 1)
                throw new Error('请在问题卡中逐项回答这组问题');
            const question = item.questions[0];
            const selected = question.options?.some((option) => option.label === text) ? [text] : [];
            this.respond({ ...item, answers: [{ id: question.id, selected, ...(selected.length ? {} : { custom: text }) }] });
        }
    }
}
//# sourceMappingURL=interactions.js.map