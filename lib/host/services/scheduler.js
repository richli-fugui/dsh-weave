import { randomUUID } from 'node:crypto';
import { WorkbenchError, ValidationError } from '../../shared/errors.js';
export class TaskScheduler {
    domain;
    executor;
    maxGlobalConcurrency;
    allowSameProjectParallel;
    workerReconciler;
    activeRuns = new Map();
    queuedItems = [];
    globalStopEpoch = 0;
    cancelledQueueItemIds = new Set();
    cancelledIntentIds = new Set();
    constructor(domain, executor, options = {}) {
        this.domain = domain;
        this.executor = executor;
        this.maxGlobalConcurrency = options.maxGlobalConcurrency ?? 2;
        this.allowSameProjectParallel = options.allowSameProjectParallel ?? false;
        this.workerReconciler = options.workerReconciler;
        // Fail closed on database/recovery failure; never pretend a broken queue is empty.
        this.domain.reconcileCrashedRunsOnStartup();
        this.queuedItems = this.domain.listPendingQueue().map(item => ({ ...item }));
        queueMicrotask(() => this.drainQueue());
    }
    /**
     * 批量推进多个任务
     */
    async dispatchBatch(taskIds, clientRequestIdPrefix, intentId, exactRequestId = false) {
        if (!clientRequestIdPrefix?.trim())
            throw new ValidationError('clientRequestId is required');
        if (exactRequestId && taskIds.length !== 1)
            throw new ValidationError('An exact request key requires one task');
        const acceptedRuns = [];
        for (const taskId of [...new Set(taskIds)]) {
            const clientRequestId = exactRequestId ? clientRequestIdPrefix : clientRequestIdPrefix + '-' + taskId;
            const input = { taskId, clientRequestId, intentId };
            const existing = this.domain.getRunForRequest(input);
            if (existing) {
                acceptedRuns.push(existing);
                continue;
            }
            const queued = this.domain.getQueueForRequest(input);
            if (queued) {
                if (queued.status === 'unknown')
                    throw new WorkbenchError('Queue outcome requires reconciliation', 'UNKNOWN_OUTCOME');
                if (queued.status === 'cancelled')
                    throw new WorkbenchError('This queued request was cancelled; use a new request for new work', 'CANCELLED');
                if (queued.status === 'started')
                    throw new WorkbenchError('Accepted queue outcome is not yet known', 'UNKNOWN_OUTCOME');
                continue;
            }
            const task = this.domain.getTask(taskId);
            const unresolved = this.domain.listRuns(taskId).some(r => ['running', 'stopping', 'awaiting_input', 'unknown'].includes(r.state));
            if (unresolved || this.domain.listUncertainQueue().some(q => q.taskId === taskId)) {
                throw new WorkbenchError('Task has an unresolved execution; reconcile it before starting another', 'UNKNOWN_OUTCOME');
            }
            if (task.statusCode === 'done')
                continue;
            if (task.statusCode !== 'todo')
                throw new ValidationError('Task is not ready for a new execution');
            if (this.queuedItems.some(q => q.taskId === taskId)) {
                throw new WorkbenchError('Task is already queued under a different request', 'CONFLICT');
            }
            const depsReady = task.dependencies.every(id => this.domain.getTask(id).statusCode === 'done');
            if (!depsReady || !this.canSchedule(task)) {
                const queuedItem = {
                    id: randomUUID(), taskId, clientRequestId, intentId, taskTitle: task.title,
                    projectId: task.projectId, controlEpoch: this.globalStopEpoch,
                };
                // Persist first: a failed write must never leave a runnable in-memory phantom.
                this.domain.enqueueTask(queuedItem);
                this.queuedItems.push(queuedItem);
                continue;
            }
            acceptedRuns.push(this.startTaskRun(task, clientRequestId, intentId));
        }
        return acceptedRuns;
    }
    startTaskRun(task, clientRequestId, intentId, queueItemId) {
        const abortController = new AbortController();
        const admission = this.domain.admitRun({ taskId: task.id, clientRequestId, intentId }, queueItemId);
        const run = admission.run;
        if (!admission.created)
            return run;
        let resolveStop;
        const stopPromise = new Promise((resolve) => {
            resolveStop = resolve;
        });
        const handle = {
            runId: run.id,
            taskId: task.id,
            projectId: task.projectId,
            intentId,
            abortController,
            taskTitle: task.title,
            stopping: false,
            stopPromise,
            resolveStop,
            epoch: this.globalStopEpoch,
        };
        this.activeRuns.set(run.id, handle);
        // 异步执行 worker
        this.executeRunAsync(run, task, abortController, handle);
        return run;
    }
    /**
     * 判断某个任务当前是否满足并发与项目互斥约束
     */
    canSchedule(task) {
        // Unknown workers may still be writing: their project stays protected, even in parallel mode.
        if (this.domain.hasUncertainProject(task.projectId))
            return false;
        if (this.activeRuns.size >= this.maxGlobalConcurrency) {
            return false;
        }
        if (!this.allowSameProjectParallel) {
            for (const info of this.activeRuns.values()) {
                if (info.projectId === task.projectId) {
                    return false;
                }
            }
        }
        return true;
    }
    /**
     * 当有任务退出（完成或中断）后，唤醒排队项
     * 修复队列漏项 bug：即使达到并发上限中断，未遍历到的队列项也必须完整保留在 unconsumed
     * 修复停止范围泄露：按工作范围隔离取消，绝不因停止 A 而误删无关任务 B
     */
    drainQueue() {
        if (this.activeRuns.size >= this.maxGlobalConcurrency || this.queuedItems.length === 0)
            return;
        const pending = this.queuedItems;
        this.queuedItems = [];
        const unconsumed = [];
        for (const item of pending) {
            if (this.activeRuns.size >= this.maxGlobalConcurrency) {
                unconsumed.push(item);
                continue;
            }
            try {
                const task = this.domain.getTask(item.taskId);
                const existing = this.domain.getRunForRequest(item);
                if (existing) {
                    this.domain.updateQueueItemStatus(item.id, 'started');
                    continue; // Replaying admission is never permission to execute again.
                }
                if (task.statusCode === 'done' || task.statusCode === 'cancelled' ||
                    this.cancelledQueueItemIds.has(item.id) ||
                    (item.intentId && this.cancelledIntentIds.has(item.intentId)) ||
                    item.controlEpoch < this.globalStopEpoch) {
                    this.domain.updateQueueItemStatus(item.id, 'cancelled');
                    continue;
                }
                const depsReady = task.dependencies.every(id => this.domain.getTask(id).statusCode === 'done');
                if (task.statusCode === 'todo' && depsReady && this.canSchedule(task)) {
                    this.startTaskRun(task, item.clientRequestId, item.intentId, item.id);
                }
                else
                    unconsumed.push(item);
            }
            catch (err) {
                if (err instanceof WorkbenchError && err.code === 'NOT_FOUND') {
                    this.domain.updateQueueItemStatus(item.id, 'cancelled');
                }
                else {
                    // A failed claim rolls back and remains durable/retryable, never silently lost.
                    unconsumed.push(item);
                }
            }
        }
        this.queuedItems = [...unconsumed, ...this.queuedItems];
    }
    // ================= 独立控制路径 Stop / Interrupt =================
    /**
     * 停止指定目标（可为 runId、taskId 或 queueItemId）
     * 精确范围隔离：仅停止指定目标，绝不波及其他任务
     */
    async stopRun(targetId, timeoutMs = 1500) {
        const commandId = randomUUID();
        const unknown = this.getControlSnapshot().items.filter(item => item.state === 'unknown' &&
            (item.runId === targetId || item.taskId === targetId));
        if (unknown.length)
            return { commandId, status: 'conflict', stoppedRunIds: [], pendingToolIds: unknown.map(item => item.runId) };
        // 1. 检查是否在排队队列中
        const qIdx = this.queuedItems.findIndex((q) => q.id === targetId || q.taskId === targetId || q.clientRequestId === targetId);
        if (qIdx !== -1) {
            const item = this.queuedItems[qIdx];
            this.domain.cancelQueueItems([item.id]);
            this.queuedItems.splice(qIdx, 1);
            this.cancelledQueueItemIds.add(item.id);
            return {
                commandId,
                status: 'stopped',
                stoppedRunIds: [item.taskId],
            };
        }
        // 2. 检查是否处于活跃执行中
        let handle = this.activeRuns.get(targetId);
        if (!handle) {
            // 允许按 taskId 查找
            for (const h of this.activeRuns.values()) {
                if (h.taskId === targetId) {
                    handle = h;
                    break;
                }
            }
        }
        if (!handle) {
            // 检查数据库记录
            try {
                const run = this.domain.getRun(targetId);
                if (['completed', 'failed', 'interrupted', 'stopped'].includes(run.state)) {
                    return { commandId, status: 'already_terminal', stoppedRunIds: [targetId] };
                }
            }
            catch {
                return { commandId, status: 'already_terminal', stoppedRunIds: [] };
            }
        }
        if (handle) {
            handle.stopping = true;
            this.domain.updateRunState(handle.runId, 'stopping');
            // 真实触发取消信号
            handle.abortController.abort();
            // 处于停止中的任务继续占用 activeRuns，防止新任务在其收敛前抢占调度
            let workerExited = false;
            await Promise.race([
                handle.stopPromise.then(() => {
                    workerExited = true;
                }),
                new Promise((r) => setTimeout(r, timeoutMs)),
            ]);
            if (workerExited) {
                return {
                    commandId,
                    status: 'stopped',
                    stoppedRunIds: [handle.runId],
                };
            }
            else {
                // 工具尚未收敛退出，如实报告状态为 waiting_tool_exit
                return {
                    commandId,
                    status: 'waiting_tool_exit',
                    stoppedRunIds: [handle.runId],
                    pendingToolIds: [handle.runId],
                };
            }
        }
        return { commandId, status: 'stopped', stoppedRunIds: [targetId] };
    }
    /**
     * 停止指定 WorkIntent 涉及的全部工作
     * 仅作用于属于该 intent 的任务
     */
    async stopIntent(intentId, timeoutMs = 1500) {
        const commandId = randomUUID();
        this.cancelledIntentIds.add(intentId);
        this.domain.incrementWorkIntentEpoch(intentId);
        this.domain.updateWorkIntentStatus(intentId, 'stopping');
        // 1. 从等待队列剔除该 intent 的项
        this.domain.cancelQueueItems(this.queuedItems.filter(q => q.intentId === intentId).map(q => q.id));
        const remaining = [];
        for (const q of this.queuedItems) {
            if (q.intentId === intentId) {
                try {
                    this.domain.updateQueueItemStatus(q.id, 'cancelled');
                }
                catch { }
            }
            else {
                remaining.push(q);
            }
        }
        this.queuedItems = remaining;
        // 2. 收集属于该 intent 的活跃 Run 并触发中断
        const stoppedRunIds = [];
        const targets = [...this.activeRuns.values()].filter((h) => h.intentId === intentId);
        const stopPromises = [];
        for (const h of targets) {
            h.stopping = true;
            this.domain.updateRunState(h.runId, 'stopping');
            h.abortController.abort();
            stoppedRunIds.push(h.runId);
            stopPromises.push(h.stopPromise);
        }
        let allExited = false;
        await Promise.race([
            Promise.all(stopPromises).then(() => {
                allExited = true;
            }),
            new Promise((r) => setTimeout(r, timeoutMs)),
        ]);
        const unknownIds = this.getControlSnapshot().items.filter(i => i.state === 'unknown' && i.intentId === intentId).map(i => i.runId);
        const pendingIds = [...targets.filter(h => this.activeRuns.has(h.runId)).map(h => h.runId), ...unknownIds];
        allExited = allExited && pendingIds.length === 0;
        if (allExited) {
            this.domain.updateWorkIntentStatus(intentId, 'stopped');
        }
        return {
            commandId,
            status: allExited ? 'stopped' : 'waiting_tool_exit',
            stoppedRunIds,
            pendingToolIds: allExited ? undefined : pendingIds,
        };
    }
    /**
     * 停止工作台当前拥有的全部活跃工作（不波及宿主其他任务）
     */
    async stopAll(timeoutMs = 1500) {
        const commandId = randomUUID();
        // A durable cancellation failure is an error, never a successful stop ACK.
        this.domain.cancelQueueItems(this.queuedItems.map(q => q.id));
        this.globalStopEpoch++;
        this.queuedItems = [];
        const stoppedRunIds = [];
        const stopPromises = [];
        for (const handle of this.activeRuns.values()) {
            handle.stopping = true;
            this.domain.updateRunState(handle.runId, 'stopping');
            handle.abortController.abort();
            stoppedRunIds.push(handle.runId);
            stopPromises.push(handle.stopPromise);
        }
        let allExited = false;
        await Promise.race([
            Promise.all(stopPromises).then(() => {
                allExited = true;
            }),
            new Promise((r) => setTimeout(r, timeoutMs)),
        ]);
        const unknownIds = this.getControlSnapshot().items.filter(i => i.state === 'unknown').map(i => i.runId);
        const pendingIds = [...this.activeRuns.values()].map(h => h.runId).concat(unknownIds);
        allExited = allExited && pendingIds.length === 0;
        return {
            commandId,
            status: allExited ? 'stopped' : 'waiting_tool_exit',
            stoppedRunIds,
            pendingToolIds: allExited ? undefined : pendingIds,
        };
    }
    /**
     * 状态快照供常驻控制条消费
     */
    getControlSnapshot() {
        const items = [];
        let awaitingCount = 0;
        for (const h of this.activeRuns.values()) {
            const run = this.domain.getRun(h.runId);
            if (run.state === 'awaiting_input')
                awaitingCount++;
            items.push({
                runId: h.runId,
                taskId: h.taskId,
                taskTitle: h.taskTitle,
                projectId: h.projectId,
                state: h.stopping ? 'stopping' : run.state,
                intentId: h.intentId,
            });
        }
        for (const run of this.domain.listUncertainRuns()) {
            const task = this.domain.getTask(run.taskId);
            items.push({ runId: run.id, taskId: task.id, taskTitle: task.title, projectId: task.projectId, state: 'unknown', intentId: run.intentId });
        }
        for (const q of this.domain.listUncertainQueue()) {
            items.push({ runId: q.id, taskId: q.taskId, taskTitle: q.taskTitle, projectId: q.projectId, state: 'unknown', intentId: q.intentId });
        }
        for (const q of this.queuedItems) {
            items.push({
                runId: q.id,
                taskId: q.taskId,
                taskTitle: q.taskTitle,
                projectId: q.projectId,
                state: 'queued',
                intentId: q.intentId,
            });
        }
        return {
            activeCount: this.activeRuns.size,
            queuedCount: this.queuedItems.length,
            awaitingCount,
            unknownCount: items.filter(i => i.state === 'unknown').length,
            items,
        };
    }
    getActiveRunCount() {
        return this.activeRuns.size;
    }
    isRunActive(runId) {
        return this.activeRuns.has(runId);
    }
    getControlEpoch() {
        return this.globalStopEpoch;
    }
    getQueuedCount() {
        return this.queuedItems.length;
    }
    getQueuedItems() {
        return [...this.queuedItems];
    }
    /**
     * 自动与 Worker / 宿主对账未知状态执行（T-012）
     * 必须基于可验证的 Host 查询结论，确认退出或完成后解除对应保护
     */
    async reconcileUncertainRuns() {
        const uncertainRuns = this.domain.listUncertainRuns();
        const reconciled = [];
        const stillUncertain = [];
        for (const run of uncertainRuns) {
            if (!this.workerReconciler) {
                stillUncertain.push(run.id);
                continue;
            }
            try {
                const check = await this.workerReconciler({
                    runId: run.id,
                    taskId: run.taskId,
                    clientRequestId: run.clientRequestId,
                    workerSessionId: run.workerSessionId,
                });
                if (check.state === 'completed') {
                    this.domain.reconcileUnknownRun(run.id, {
                        state: 'completed',
                        summary: check.summary || 'Worker execution completed and verified by host',
                        artifactRefs: check.artifactRefs,
                        outcome: check.outcome,
                    });
                    reconciled.push({ runId: run.id, resolvedState: 'completed' });
                }
                else if (check.state === 'exited' || check.state === 'not_found') {
                    this.domain.reconcileUnknownRun(run.id, {
                        state: 'interrupted',
                        summary: check.summary || `Worker confirmed terminated (${check.state}) by host`,
                        outcome: check.outcome,
                    });
                    reconciled.push({ runId: run.id, resolvedState: 'interrupted' });
                }
                else {
                    // Worker 仍处于运行中，不能提前解除保护
                    stillUncertain.push(run.id);
                }
            }
            catch {
                stillUncertain.push(run.id);
            }
        }
        if (reconciled.length > 0) {
            this.drainQueue();
        }
        return { reconciled, stillUncertain };
    }
    /**
     * 显式对账未知 Run（操作员决策或已确认证据）
     */
    reconcileRun(runId, resolution) {
        const res = this.domain.reconcileUnknownRun(runId, resolution);
        this.drainQueue();
        return res;
    }
    /**
     * 显式对账未知队列项
     */
    reconcileQueue(queueId, action = 'cancel') {
        const item = this.domain.reconcileUnknownQueue(queueId, action);
        if (action === 'retry') {
            this.queuedItems.push({
                id: item.id,
                taskId: item.taskId,
                clientRequestId: item.clientRequestId,
                intentId: item.intentId,
                taskTitle: item.taskTitle,
                projectId: item.projectId,
                controlEpoch: item.controlEpoch,
            });
        }
        this.drainQueue();
        return item;
    }
    async executeRunAsync(run, task, abortController, handle) {
        const project = this.domain.getProject(task.projectId);
        try {
            const res = await this.executor(task, project.rootPath, abortController.signal);
            if (abortController.signal.aborted) {
                this.domain.updateRunState(run.id, 'interrupted', { reason: 'User requested stop' });
                const currentTask = this.domain.getTask(task.id);
                if (currentTask.statusCode === 'in_progress') {
                    this.domain.updateTask({
                        id: task.id,
                        expectedRevision: currentTask.revision,
                        statusCode: 'todo',
                    });
                }
                return;
            }
            this.domain.completeRun({
                runId: run.id,
                state: res.state,
                summary: res.summary,
                artifactRefs: res.artifactRefs,
                evidenceRefs: res.evidenceRefs,
                nextActions: res.nextActions,
                suggestedTaskStatus: res.suggestedTaskStatus,
                outcome: res.outcome,
            });
        }
        catch (err) {
            if (abortController.signal.aborted) {
                this.domain.updateRunState(run.id, 'interrupted', { reason: 'User requested stop' });
                const currentTask = this.domain.getTask(task.id);
                if (currentTask.statusCode === 'in_progress') {
                    this.domain.updateTask({
                        id: task.id,
                        expectedRevision: currentTask.revision,
                        statusCode: 'todo',
                    });
                }
                return;
            }
            this.domain.completeRun({
                runId: run.id,
                state: 'failed',
                summary: `Worker execution encountered unhandled error: ${err.message}`,
                suggestedTaskStatus: 'blocked',
            });
        }
        finally {
            this.activeRuns.delete(run.id);
            if (handle.intentId) {
                const intent = this.domain.getWorkIntent(handle.intentId);
                if (intent.status === 'stopping' && !this.getControlSnapshot().items.some(i => i.intentId === handle.intentId)) {
                    this.domain.updateWorkIntentStatus(handle.intentId, 'stopped');
                }
            }
            handle.resolveStop();
            this.drainQueue();
        }
    }
}
//# sourceMappingURL=scheduler.js.map