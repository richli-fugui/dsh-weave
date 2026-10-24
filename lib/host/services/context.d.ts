import type { WorkbenchDomain } from './domain.js';
export interface ContextBudget {
    maxPromptTokens?: number;
}
export interface CompactProjectSummary {
    id: string;
    title: string;
    goal: string;
    rootPath: string;
    taskCount: number;
    activeCount: number;
}
export interface TaskBrief {
    id: string;
    title: string;
    goal: string;
    acceptance: string;
    status: string;
    priority: string;
    dependencies: string[];
    revision: number;
}
export interface HandoverRecord {
    previousSessionId: string;
    targetSessionId: string;
    sessionMode: 'dsh-session-controller' | 'self-managed-state';
    timestamp: string;
    summary: string;
    activeProjects: Array<{
        id: string;
        title: string;
        goal: string;
    }>;
    pendingTasks: Array<{
        id: string;
        title: string;
        goal: string;
        priority: string;
        status: string;
    }>;
    recentDecisions: string[];
    recentOutcomes: Array<{
        runId: string;
        summary: string;
    }>;
}
export declare class WorkbenchContextManager {
    private readonly domain;
    constructor(domain: WorkbenchDomain);
    /**
     * 粗略估算文本 Token 数量（中英混合启发式，中文约 1-1.5 token/字，英文约 1 token/4字符）
     */
    estimateTokens(text: string): number;
    /**
     * 生成有界的主助理上下文（Prompt 组装并强制执行预算）
     * @param focusedProjectId 当前聚焦的项目（若有）
     * @param referencedTaskIds 用户在当前回合或消息中显式 @ 或拖入引用的任务 ID
     * @param budget 上下文预算限制
     */
    buildBoundedContext(focusedProjectId?: string, referencedTaskIds?: string[], budget?: ContextBudget): string;
    /**
     * 宿主保存执行原文；工作台保存逻辑入口消息与领域回执。
     * 每轮附加有界投影，覆盖未进入宿主的建卡/停止/成果与会话重建窗口。
     * 历史只作为资料，绝不作为新指令逐条重放。
     */
    buildHostTurnInput(userText: string, focusedProjectId: string | undefined, history: Array<{
        sender: string;
        text: string;
    }>): string;
    /**
     * 生成任务简报（TaskBrief）
     */
    getTaskBrief(taskId: string): TaskBrief;
    /**
     * 轮换底层会话，提取当前跨会话关键交接信息并持久化，保证无感无断层交接
     * - newSessionId 提供时必须为非空且不等于当前会话；
     * - sessionVerifier 提供时进入“真实绑定模式”：目标会话必须经宿主验证真实可用，
     *   未通过则拒绝轮换（严禁把合成 ID 当作已验证会话）；未提供时为自管模式并如实标注。
     */
    rotateSession(stableId?: string, newSessionId?: string, sessionVerifier?: (id: string) => Promise<boolean> | boolean, previousMessages?: Array<{
        sender: string;
        text: string;
    }>): Promise<{
        stableId: any;
        currentSessionId: any;
        generation: any;
        memoryIndex: any;
        updatedAt: any;
    }>;
}
//# sourceMappingURL=context.d.ts.map