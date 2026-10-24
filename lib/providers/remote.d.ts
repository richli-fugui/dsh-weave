import { WorkbenchError } from '../shared/errors.js';
import type { AssistantState, ChatMessage, CompleteRunInput, ControlSnapshot, CreateProjectInput, CreateTaskInput, OutboxEvent, Project, Result, Run, StartRunInput, StopResult, Task, UpdateProjectInput, UpdateTaskInput, WorkIntent } from '../shared/types.js';
import type { WorkbenchProvider } from './types.js';
/**
 * 工作台与 Remote Connect 之间的公共契约版本（docs/REMOTECONNECT_CONTRACT.md / dsh-remoteconnect WORKBENCH_INTEGRATION.md）。
 * 当前双方文件均为 0.1-draft 草案；本常量随联合契约冻结而更新。
 */
export declare const WORKBENCH_REMOTE_CONTRACT_VERSION = "0.1-draft";
/** 连接层状态（契约拟定词表；仅识别，不发明新状态） */
export type RemoteConnectionState = 'disconnected' | 'connecting' | 'auth_required' | 'ready' | 'recovering' | 'error';
/** 对端身份（契约拟定字段；实现对齐后由生成类型核对，当前为逻辑契约） */
export interface RemoteIdentity {
    hostId: string;
    profileId?: string;
    dshVersion?: string;
    connectionProtocolVersion?: string;
    serverEpoch?: string | number;
    workbenchContractVersion?: string;
    capabilities?: string[];
}
export interface RemoteConnectionAdapter {
    connectionId: string;
    isReady(): boolean;
    invoke<T>(endpoint: string, payload: unknown): Promise<T>;
    follow(endpoint: string, payload: unknown, onData: (data: any) => void): () => void;
    /** 可选：连接层状态词表（区分 auth_required 与 offline，契约要求不得混同） */
    getState?(): RemoteConnectionState;
    /** 可选：连接 generation 变化通知（重连/换载体）；提供时 RemoteProvider 据此失效旧响应并重建订阅 */
    onGenerationChange?(callback: (generation: number) => void): () => void;
}
/**
 * 同族契约（如 0.1-draft / 0.1-rc2）视为兼容；对端显式声明不同族版本时必须硬阻塞，
 * 严禁静默降级到 Mac 本地执行（契约错误与版本一节）。
 */
export declare function isContractCompatible(version: string | undefined | null): boolean;
/** 错误分类（契约要求最少区分的词表，作为 WorkbenchError.code 透出） */
export type RemoteErrorCode = 'AUTH_REQUIRED' | 'OFFLINE' | 'UNSUPPORTED_VERSION' | 'UNSUPPORTED_CAPABILITY' | 'CONFLICT' | 'UNKNOWN_OUTCOME' | 'CANCELLED' | 'DOMAIN_ERROR';
/**
 * 把适配器抛出的 wire 错误映射为契约错误分类。
 * 识别顺序：显式 code/wireCode → 消息启发式；无法识别时保守归为 DOMAIN_ERROR，
 * 绝不把无法解释的结果当作成功或未执行。
 */
export declare function mapWireError(err: unknown): WorkbenchError;
/**
 * RemoteProvider：Mac Client 侧消费 Windows 工作台 Domain 的统一入口。
 * 契约要点（0.1-draft）：
 * - 首次使用前向对端协商身份与契约版本；显式声明不兼容版本时硬阻塞（UNSUPPORTED_VERSION）；
 *   对端未实现身份端点（如纯 stub）时进入“未验证兼容模式”并如实标注，不冒充已验证。
 * - 所有写命令自动注入 clientRequestId（调用方已提供时保留原值），副作用幂等对账由该 ID 承载。
 * - 连接 generation 变化：立即失效旧 follow 订阅，作废已协商身份，下一次调用重新协商；
 *   不把旧 generation 的异步响应当作当前事实。
 * - 错误按契约词表分类透出；不自动重发非幂等写操作。
 */
export declare class RemoteProvider implements WorkbenchProvider {
    private readonly connection;
    private identity;
    private identityVerified;
    private negotiatedInCompatMode;
    private lastGeneration;
    private generationCounter;
    private readonly activeFollows;
    private readonly generationDisposer;
    constructor(connection: RemoteConnectionAdapter);
    /** 当前协商结果；identityVerified=false 表示对端未声明身份（未验证兼容模式） */
    getIdentity(): {
        identity: RemoteIdentity | null;
        verified: boolean;
        compatMode: boolean;
    };
    /**
     * 向对端协商身份与契约版本。对端显式声明不兼容版本 → UNSUPPORTED_VERSION 硬阻塞；
     * 对端未实现身份端点（UNSUPPORTED_CAPABILITY 且未声明版本）→ 未验证兼容模式，如实标注。
     */
    negotiate(): Promise<RemoteIdentity>;
    private ensureNegotiated;
    private checkReady;
    private invokeDomain;
    /** 写命令幂等：调用方已带 clientRequestId 时保留，否则生成（契约：所有写命令带 clientRequestId） */
    private withClientRequestId;
    private invalidateOnGeneration;
    createWorkIntent(rawInput: string, projectId?: string): Promise<WorkIntent>;
    getControlSnapshot(): Promise<ControlSnapshot>;
    stopRun(runId: string): Promise<StopResult>;
    stopIntent(intentId: string): Promise<StopResult>;
    stopAll(): Promise<StopResult>;
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
    reconcileQueue(queueId: string, action?: 'cancel' | 'retry'): Promise<any>;
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
    /**
     * 订阅领域事件流。契约要求 baseline + sequence/delta 语义：
     * 本方法按 sequence 去重与单调推进（重复/回退投递不重复回调），generation 变化时自动失效。
     */
    followEvents(afterSequence: number, callback: (event: OutboxEvent) => void): () => void;
}
//# sourceMappingURL=remote.d.ts.map