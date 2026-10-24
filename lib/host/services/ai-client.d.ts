export interface AIClientConfig {
    baseURL?: string;
    apiKey?: string;
    model?: string;
    timeoutMs?: number;
}
export declare class DshAIClient {
    private baseURL;
    private apiKey;
    private model;
    private timeoutMs;
    constructor(config?: AIClientConfig);
    getBackendInfo(): {
        backend: string;
        baseURL: string;
        model: string;
        capabilities: {
            textGeneration: boolean;
            projectFileIO: boolean;
            hostAgentSandbox: boolean;
            approvalPipeline: boolean;
        };
        disclosed: boolean;
    };
    /**
     * 检查宿主 AI 桥接端点是否可用且已授权
     */
    checkAvailability(): Promise<boolean>;
    /**
     * 调用聊天补全接口生成自然语言回复
     */
    generateCompletion(messages: Array<{
        role: 'user' | 'assistant' | 'system';
        content: string;
    }>, options?: {
        model?: string;
        temperature?: number;
        maxTokens?: number;
        signal?: AbortSignal;
    }): Promise<string>;
    /**
     * 执行真实办公与业务任务（如整理会议纪要、生成交付文档等）
     * 必须真正完成用户要求并返回实际交付文本，而非元数据。
     */
    executeOfficeTask(taskTitle: string, taskGoal: string, taskAcceptance?: string, signal?: AbortSignal): Promise<{
        content: string;
        acceptanceMet: boolean;
        summary: string;
    }>;
}
//# sourceMappingURL=ai-client.d.ts.map