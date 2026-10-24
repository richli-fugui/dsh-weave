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
export declare function WorkbenchView({ onClose }: {
    onClose?: () => void;
}): React.JSX.Element;
export declare const name = "workbench";
export declare const inject: string[];
export declare function apply(ctx: any): () => void;
//# sourceMappingURL=client.d.ts.map