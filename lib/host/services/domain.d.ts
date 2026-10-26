import type { DatabaseSync } from 'node:sqlite';
import type { ChatMessage, CompleteRunInput, CreateProjectInput, CreateTaskInput, OutboxEvent, Project, Result, Run, StartRunInput, Task, UpdateProjectInput, UpdateTaskInput, WorkIntent } from '../../shared/types.js';
export declare class WorkbenchDomain {
    private readonly db;
    constructor(db: DatabaseSync);
    createProject(input: CreateProjectInput): Project;
    getProject(id: string): Project;
    listProjects(): Project[];
    updateProject(input: UpdateProjectInput): Project;
    createTask(input: CreateTaskInput): Task;
    getTask(id: string): Task;
    listTasks(projectId?: string): Task[];
    updateTask(input: UpdateTaskInput): Task;
    /** Request identity covers execution, not just the number of Run rows. */
    getRunForRequest(input: StartRunInput): Run | undefined;
    startRun(input: StartRunInput): Run;
    /** Persist admission and queue consumption together; only created=true may execute. */
    admitRun(input: StartRunInput, queueItemId?: string): {
        run: Run;
        created: boolean;
    };
    getRun(id: string): Run;
    attachWorkerSession(runId: string, workerSessionId: string): void;
    listRuns(taskId?: string): Run[];
    listRunningRuns(): Run[];
    reconcileCrashedRunsOnStartup(): {
        reconciledRunsCount: number;
        reconciledQueueCount: number;
    };
    hasUncertainProject(projectId: string): boolean;
    listUncertainQueue(): {
        id: string;
        taskId: string;
        clientRequestId: string;
        intentId?: string;
        taskTitle: string;
        projectId: string;
        controlEpoch: number;
        status: string;
        createdAt: string;
    }[];
    listUncertainRuns(): Run[];
    /**
     * 对账并解除未知状态的执行（T-012）
     * 必须基于真实的 Worker 查询或操作员显式判定，原子推进任务状态与清理保护
     */
    reconcileUnknownRun(runId: string, resolution: {
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
        result?: Result;
    };
    /**
     * 对账孤立/未知状态的队列项
     */
    reconcileUnknownQueue(queueId: string, action?: 'cancel' | 'retry'): {
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
    completeRun(input: CompleteRunInput): {
        run: Run;
        result: Result;
    };
    getResult(id: string): Result;
    appendOutboxEvent(entityId: string, type: string, payload: Record<string, unknown>): OutboxEvent;
    listOutboxEvents(afterSequence?: number, limit?: number): OutboxEvent[];
    abandonPendingHostTurn(expectedRequestId: string, reason: string): void;
    /** Pending control and any late delivery commit together; a crash cannot deliver twice. */
    savePendingHostTurn(turn: Record<string, unknown> | null, delivery?: {
        entityId: string;
        type: string;
        payload: Record<string, unknown>;
        text?: string;
        intentId?: string;
    }): void;
    getAssistantState(stableId?: string): {
        stableId: any;
        currentSessionId: any;
        generation: any;
        memoryIndex: any;
        updatedAt: any;
    };
    rotateAssistantSession(stableId?: string, newSessionId?: string): {
        stableId: any;
        currentSessionId: any;
        generation: any;
        memoryIndex: any;
        updatedAt: any;
    };
    createWorkIntent(rawInput: string, projectId?: string): WorkIntent;
    getWorkIntent(id: string): WorkIntent;
    updateWorkIntentStatus(id: string, status: WorkIntent['status']): WorkIntent;
    incrementWorkIntentEpoch(id: string): number;
    updateRunState(runId: string, state: Run['state'], outcome?: Record<string, unknown>): Run;
    saveChatMessage(sender: 'user' | 'assistant' | 'system', text: string, intentId?: string): ChatMessage;
    /**
     * 列出聊天历史。
     * 语义：返回“最近 limit 条”并按时间正序排列（供主助理连续上下文与前端渲染使用）。
     * 修复说明：此前为 `ORDER BY created_at ASC LIMIT ?`，超过 limit 后返回的是最早一批消息，
     * 导致最新事实被永久挤出上下文（两轮指代/最新决定丢失）。现按 created_at DESC + rowid DESC
     * 稳定取最新后在内存中反转，保证同一毫秒内的批量写入也有确定顺序。
     */
    listChatMessages(limit?: number): ChatMessage[];
    private mapRunRow;
    /** UI reads can degrade gracefully; execution must not turn corrupt prerequisites into none. */
    readDependenciesForExecution(taskId: string): string[];
    getSchedulingDependencies(taskId: string): string[];
    private validateDependencies;
    enqueueTask(item: {
        id: string;
        taskId: string;
        clientRequestId: string;
        intentId?: string;
        taskTitle: string;
        projectId: string;
        controlEpoch: number;
    }): void;
    cancelQueueItems(ids: string[]): void;
    updateQueueItemStatus(id: string, status: 'started' | 'cancelled'): void;
    getQueueItem(id: string): {
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
    getQueueForRequest(input: StartRunInput): {
        id: string;
        status: string;
        createdAt: string;
    } | undefined;
    listPendingQueue(): {
        id: string;
        taskId: string;
        clientRequestId: string;
        intentId?: string;
        taskTitle: string;
        projectId: string;
        controlEpoch: number;
        status: string;
        createdAt: string;
    }[];
    private listQueueByStatus;
}
//# sourceMappingURL=domain.d.ts.map