import type { WorkbenchDomain } from '../host/services/domain.js';
import type { TaskScheduler } from '../host/services/scheduler.js';
import type { WorkbenchContextManager } from '../host/services/context.js';
import type { HostSessionTracker } from '../host/services/host-tracker.js';
import type { AssistantState, ChatMessage, CompleteRunInput, ControlSnapshot, CreateProjectInput, CreateTaskInput, OutboxEvent, Project, Result, Run, StartRunInput, StopResult, Task, UpdateProjectInput, UpdateTaskInput, WorkIntent } from '../shared/types.js';
import type { WorkbenchProvider } from './types.js';
export declare class LocalProvider implements WorkbenchProvider {
    private readonly domain;
    private readonly scheduler?;
    private readonly contextManager?;
    private readonly hostTracker?;
    constructor(domain: WorkbenchDomain, scheduler?: TaskScheduler | undefined, contextManager?: WorkbenchContextManager | undefined, hostTracker?: HostSessionTracker | undefined);
    createWorkIntent(rawInput: string, projectId?: string): Promise<WorkIntent>;
    getControlSnapshot(): Promise<ControlSnapshot>;
    stopRun(runId: string): Promise<StopResult>;
    stopIntent(intentId: string): Promise<StopResult>;
    stopAll(): Promise<StopResult>;
    saveChatMessage(sender: 'user' | 'assistant' | 'system', text: string, intentId?: string): Promise<ChatMessage>;
    listChatMessages(): Promise<ChatMessage[]>;
    listProjects(): Promise<Project[]>;
    getProject(id: string): Promise<Project>;
    createProject(input: CreateProjectInput): Promise<Project>;
    updateProject(input: UpdateProjectInput): Promise<Project>;
    listTasks(projectId?: string): Promise<Task[]>;
    getTask(id: string): Promise<Task>;
    createTask(input: CreateTaskInput): Promise<Task>;
    updateTask(input: UpdateTaskInput): Promise<Task>;
    startRun(input: StartRunInput): Promise<Run>;
    completeRun(input: CompleteRunInput): Promise<{
        run: Run;
        result: Result;
    }>;
    getRun(id: string): Promise<Run>;
    listRuns(taskId?: string): Promise<Run[]>;
    getResult(id: string): Promise<Result>;
    getAssistantState(stableId?: string): Promise<AssistantState>;
    rotateAssistantSession(stableId?: string, newSessionId?: string): Promise<AssistantState>;
    listUncertain(): Promise<{
        runs: Run[];
        queue: any[];
    }>;
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
    }): Promise<{
        run: Run;
        result?: Result;
    }>;
    reconcileQueue(queueId: string, action?: 'cancel' | 'retry'): Promise<{
        id: string;
        taskId: string;
        clientRequestId: string;
        intentId: string | undefined;
        taskTitle: string;
        projectId: string;
        controlEpoch: number;
        status: string;
        createdAt: string;
    }>;
    autoReconcileWithWorker(): Promise<{
        reconciled: Array<{
            runId: string;
            resolvedState: string;
        }>;
        stillUncertain: string[];
    }>;
    followEvents(afterSequence: number, callback: (event: OutboxEvent) => void): () => void;
}
//# sourceMappingURL=local.d.ts.map