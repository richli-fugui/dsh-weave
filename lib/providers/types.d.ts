import type { AssistantState, ChatMessage, CompleteRunInput, ControlSnapshot, CreateProjectInput, CreateTaskInput, OutboxEvent, Project, Result, Run, StartRunInput, StopResult, Task, UpdateProjectInput, UpdateTaskInput, WorkIntent } from '../shared/types.js';
export interface WorkbenchProvider {
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
    createWorkIntent(rawInput: string, projectId?: string): Promise<WorkIntent>;
    getControlSnapshot(): Promise<ControlSnapshot>;
    stopRun(runId: string): Promise<StopResult>;
    stopIntent(intentId: string): Promise<StopResult>;
    stopAll(): Promise<StopResult>;
    saveChatMessage(sender: 'user' | 'assistant' | 'system', text: string, intentId?: string): Promise<ChatMessage>;
    listChatMessages(): Promise<ChatMessage[]>;
    followEvents(afterSequence: number, callback: (event: OutboxEvent) => void): () => void;
}
//# sourceMappingURL=types.d.ts.map