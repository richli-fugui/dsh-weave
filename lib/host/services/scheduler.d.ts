import type { WorkbenchDomain } from './domain.js';
import type { ControlSnapshot, Run, StopResult, Task } from '../../shared/types.js';
export interface WorkerExecutionResult {
    state: 'completed' | 'failed' | 'interrupted';
    summary: string;
    artifactRefs?: Array<{
        title: string;
        path: string;
        kind?: string;
    }>;
    evidenceRefs?: string[];
    nextActions?: string[];
    suggestedTaskStatus?: 'todo' | 'in_progress' | 'blocked' | 'review' | 'done';
    outcome?: Record<string, unknown>;
}
export type WorkerExecutor = (task: Task, projectRoot: string, signal: AbortSignal, context?: {
    runId: string;
}) => Promise<WorkerExecutionResult>;
export interface WorkerReconciliationResult {
    state: 'running' | 'completed' | 'exited' | 'not_found';
    summary?: string;
    artifactRefs?: Array<{
        title: string;
        path: string;
        kind?: string;
    }>;
    outcome?: Record<string, unknown>;
}
export type WorkerReconciler = (info: {
    runId: string;
    taskId: string;
    clientRequestId: string;
    workerSessionId?: string;
}) => Promise<WorkerReconciliationResult>;
export interface SchedulerOptions {
    maxGlobalConcurrency?: number;
    allowSameProjectParallel?: boolean;
    workerReconciler?: WorkerReconciler;
}
export interface QueuedItem {
    id: string;
    taskId: string;
    clientRequestId: string;
    intentId?: string;
    taskTitle: string;
    projectId: string;
    controlEpoch: number;
}
export declare class TaskScheduler {
    private readonly domain;
    private readonly executor;
    private readonly maxGlobalConcurrency;
    private readonly allowSameProjectParallel;
    private readonly workerReconciler?;
    private activeRuns;
    private queuedItems;
    private globalStopEpoch;
    private cancelledQueueItemIds;
    private cancelledIntentIds;
    constructor(domain: WorkbenchDomain, executor: WorkerExecutor, options?: SchedulerOptions);
    /**
     * 批量推进多个任务
     */
    dispatchBatch(taskIds: string[], clientRequestIdPrefix: string, intentId?: string, exactRequestId?: boolean): Promise<Run[]>;
    private startTaskRun;
    /**
     * 判断某个任务当前是否满足并发与项目互斥约束
     */
    canSchedule(task: Task): boolean;
    /**
     * 当有任务退出（完成或中断）后，唤醒排队项
     * 修复队列漏项 bug：即使达到并发上限中断，未遍历到的队列项也必须完整保留在 unconsumed
     * 修复停止范围泄露：按工作范围隔离取消，绝不因停止 A 而误删无关任务 B
     */
    drainQueue(): void;
    /**
     * 停止指定目标（可为 runId、taskId 或 queueItemId）
     * 精确范围隔离：仅停止指定目标，绝不波及其他任务
     */
    stopRun(targetId: string, timeoutMs?: number): Promise<StopResult>;
    /**
     * 停止指定 WorkIntent 涉及的全部工作
     * 仅作用于属于该 intent 的任务
     */
    stopIntent(intentId: string, timeoutMs?: number): Promise<StopResult>;
    /**
     * 停止工作台当前拥有的全部活跃工作（不波及宿主其他任务）
     */
    stopAll(timeoutMs?: number): Promise<StopResult>;
    /**
     * 状态快照供常驻控制条消费
     */
    getControlSnapshot(): ControlSnapshot;
    getActiveRunCount(): number;
    isRunActive(runId: string): boolean;
    getControlEpoch(): number;
    getQueuedCount(): number;
    getQueuedItems(): QueuedItem[];
    /**
     * 自动与 Worker / 宿主对账未知状态执行（T-012）
     * 必须基于可验证的 Host 查询结论，确认退出或完成后解除对应保护
     */
    reconcileUncertainRuns(): Promise<{
        reconciled: Array<{
            runId: string;
            resolvedState: string;
        }>;
        stillUncertain: string[];
    }>;
    /**
     * 显式对账未知 Run（操作员决策或已确认证据）
     */
    reconcileRun(runId: string, resolution: {
        state: 'completed' | 'interrupted' | 'failed';
        summary: string;
        artifactRefs?: Array<{
            title: string;
            path: string;
            kind?: string;
        }>;
        outcome?: Record<string, unknown>;
        suggestedTaskStatus?: Task['statusCode'];
    }): {
        run: Run;
        result?: import("../../shared/types.js").Result;
    };
    /**
     * 显式对账未知队列项
     */
    reconcileQueue(queueId: string, action?: 'cancel' | 'retry'): {
        id: string;
        taskId: string;
        clientRequestId: string;
        intentId: string | undefined;
        taskTitle: string;
        projectId: string;
        controlEpoch: number;
        status: string;
        createdAt: string;
    };
    private executeRunAsync;
}
//# sourceMappingURL=scheduler.d.ts.map