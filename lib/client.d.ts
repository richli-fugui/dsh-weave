import React from 'react';
import type { StopResult } from './shared/types.js';
export declare const PANEL_ID = "workbench";
export declare const ENTRY_TITLE = "\u4EFB\u52A1\u53F0";
/** Kept pure so the packaged desktop control copy can be regression tested. */
export declare const formatStopFeedback: (res: StopResult) => string;
/** 卡片状态只呈现业务语义，不把内部状态码暴露给用户。 */
export declare const taskStatusLabel: (statusCode: string) => string;
/** 优先级同样只呈现业务语义。 */
export declare const taskPriorityLabel: (priorityCode: string) => string;
/** 运行状态同样只呈现业务语义，不把内部状态码暴露给用户。 */
export declare const runStateLabel: (state: string) => string;
export declare function WorkbenchView({ onClose }: {
    onClose?: () => void;
}): React.JSX.Element;
/**
 * 面板级错误边界：任务台自身的渲染异常降级为一张可重试的错误卡，
 * 绝不让异常冒泡炸掉宿主整个 Web 壳（面板只是宿主 UI 的一个插槽）。
 * 导出供面板契约回归测试直接验证 getDerivedStateFromError 行为。
 */
export declare class PanelErrorBoundary extends React.Component<{
    children: React.ReactNode;
}, {
    error: Error | null;
}> {
    state: {
        error: Error | null;
    };
    static getDerivedStateFromError(error: Error): {
        error: Error;
    };
    render(): string | number | boolean | React.JSX.Element | Iterable<React.ReactNode> | null | undefined;
}
export declare const name = "workbench";
export declare const inject: string[];
export declare function apply(ctx: any): () => void;
//# sourceMappingURL=client.d.ts.map