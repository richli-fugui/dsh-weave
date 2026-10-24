export interface Context {
    webServer?: any;
    systemPrompt?: any;
    tools?: any;
    sessionController?: any;
    agentRunner?: any;
    effect?: (fn: () => any, label?: string) => void;
    logger?: any;
    [key: string]: any;
}
import { type WorkerExecutor, type WorkerReconciler } from './host/services/scheduler.js';
export * from './shared/index.js';
export * from './host/services/domain.js';
export * from './host/services/scheduler.js';
export * from './host/services/context.js';
export * from './host/services/ai-client.js';
export * from './host/services/host-session.js';
export * from './providers/types.js';
export * from './providers/local.js';
export * from './providers/remote.js';
export declare const name = "workbench";
export declare const inject: string[];
export interface WorkbenchConfig {
    dbPath?: string;
    dataDir?: string;
    aiBaseURL?: string;
    aiApiKey?: string;
    aiModel?: string;
    workerExecutor?: WorkerExecutor;
    workerReconciler?: WorkerReconciler;
    /** 宿主会话桥接（sessionController）选项；全部可选，能力探测失败自动降级既有路径 */
    hostSession?: {
        enabled?: boolean;
        /** 主助理会话工作目录（默认取聚焦项目 rootPath，无项目时用 dataDir 下的 assistant-workspace） */
        cwd?: string;
        /** 显式指定时对新会话做 per-session 模型选择（不写全局默认）；不指定则用宿主默认模型 */
        model?: {
            provider: string;
            model: string;
        };
        replyTimeoutMs?: number;
    };
}
export declare function apply(ctx: Context, config?: WorkbenchConfig): void;
//# sourceMappingURL=index.d.ts.map