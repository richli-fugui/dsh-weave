export interface HostServiceProbeEntry {
    name: string;
    found: boolean;
    detail?: string;
}
/** 诊断面：枚举本插件关心的宿主服务与其方法面（脱敏，不含参数值） */
export declare function probeHostServices(ctx: unknown): {
    services: HostServiceProbeEntry[];
};
export type HostTurnStatus = 'replied' | 'accepted_no_reply_yet' | 'awaiting_input' | 'timeout' | 'error' | 'unavailable' | 'stopped';
export interface HostChatTurnResult {
    path: 'host-session' | 'unavailable';
    status: HostTurnStatus;
    sessionId?: string;
    sessionCreated?: boolean;
    requestAccepted?: boolean;
    replyText?: string;
    error?: string;
    /** 诊断用截断栈；仅本机排障透出，公开记录需脱敏 */
    errorStack?: string;
    outcomeUnknown?: boolean;
}
/** 宿主 page() 返回的事件记录的最小防御性视图 */
interface SessionEventView {
    seq?: number;
    type?: string;
    data?: {
        content?: Array<{
            type?: string;
            text?: string;
        }>;
        message?: {
            content?: Array<{
                type?: string;
                text?: string;
            }>;
        };
        source?: {
            kind?: string;
            rpcId?: string;
        };
    };
}
export interface HostBridgeOptions {
    /** 会话工作目录（createSession 需要；宿主会 mkdir） */
    cwd?: string;
    /** 显式指定时对新会话做 per-session 模型选择（不写全局默认） */
    model?: {
        provider: string;
        model: string;
    };
    /** 每次 waitReply 的总超时；默认 180s（真实模型 + 工具执行可能较慢） */
    replyTimeoutMs?: number;
    /** 轮询间隔；默认 1500ms */
    pollIntervalMs?: number;
}
/**
 * 能力核验通过后的宿主会话桥接。所有宿主调用都是可选形状二次确认，
 * 形状不符按 unavailable/error 如实处理。
 */
export declare class DshHostSessionBridge {
    private readonly controller;
    private readonly options;
    private constructor();
    /**
     * 能力探测：方法存在 + 关键签名形状核验。缺席或形状不符返回 null，
     * 调用方降级既有路径（严禁把降级冒充宿主路径）。
     */
    static probe(controller: unknown, options?: HostBridgeOptions): DshHostSessionBridge | null;
    private resolveAgent;
    /**
     * 读取会话事件。首选 resolveAgent → agent.session.snapshotEvents()（真机实证可用，
     * diagnose 同路径）；page() 因 throughSeq=-1 在宿主 paginate 中会得到空页
     * （end=min(throughSeq+1,…)=0），仅作为 snapshotEvents 缺席时的尽力回退。
     */
    /** 供诊断与跟踪服务读取会话事件 */
    eventsOf(sessionId: string): Promise<Array<unknown>>;
    /** 兼容 unwrap：接受原始事件或 page 的 {type:'event',event} 包装记录 */
    static unwrapEventOf(record: unknown): SessionEventView | undefined;
    /** 从事件记录中提取 assistant 消息 */
    static extractAssistantMessages(records: unknown): Array<{
        seq: number;
        text: string;
    }>;
    /** 从 assistant/attempt 的 stream finish 分块提取模型层错误（诚实诊断用） */
    static attemptErrorOf(event: SessionEventView): string | undefined;
    /**
     * 绑定或创建主助理会话。既有 sessionId 先经 resolveAgent 复活/复用；
     * 不可用（含 session/not-found）才创建新会话。返回的 verified 可直接
     * 作为 rotateSession 的宿主绑定证据。
     */
    ensureSession(currentSessionId: string | undefined, opts?: {
        cwd?: string;
        model?: {
            provider: string;
            model: string;
        };
    }): Promise<{
        sessionId: string;
        created: boolean;
        verified: boolean;
        error?: string;
    }>;
    /** per-session 模型选择（可选能力；绝不写全局默认，失败不阻断聊天路径） */
    private pinModelIfPossible;
    /**
     * 发送一轮用户输入并等待宿主 agent loop 的回复文本。
     * - accepted 但超时无回复 → status 'timeout'（宿主可能仍在执行，不伪造）；
     * - 宿主拒绝/异常 → status 'error' 带原始 message；
     * - 回复提取按防御性事件扫描，形状变化时宁可 timeout 也不编造文本。
     */
    sendAndCollect(sessionId: string, userText: string, opts?: {
        replyTimeoutMs?: number;
        requestId?: string;
        pending?: () => {
            title: string;
        } | undefined;
    }): Promise<HostChatTurnResult>;
    /** 取消宿主会话在途工作（可选能力） */
    cancel(sessionId: string): Promise<boolean>;
    /**
     * 只读诊断：agent 运行状态 + 最近事件（仅 type/seq，不含正文）+ 当前模型选择。
     * 供控制条/排障使用，绝不伪造状态；形状不符的字段如实标 unknown。
     */
    diagnose(sessionId: string): Promise<Record<string, unknown>>;
}
export {};
//# sourceMappingURL=host-session.d.ts.map