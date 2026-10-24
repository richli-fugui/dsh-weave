import type { WorkbenchDomain } from '../host/services/domain.js';
export interface ParsedOldCard {
    id: string;
    title: string;
    project: string;
    projectRoot: string;
    status: string;
    blockedBy: string[];
    priority: number;
    goal: string;
    acceptance: string;
    legacySessions: Record<string, string>;
    filePath: string;
}
export interface ImportPreviewResult {
    totalScanned: number;
    newCards: ParsedOldCard[];
    duplicateCards: {
        id: string;
        title: string;
        reason: string;
    }[];
    invalidCards: {
        filePath: string;
        reason: string;
    }[];
}
export interface ImportExecutionResult {
    importedCount: number;
    skippedCount: number;
    importedIds: string[];
}
export declare class MarkdownCardImporter {
    private readonly domain;
    constructor(domain: WorkbenchDomain);
    /**
     * 解析单张 Markdown 卡片内容（只读）
     */
    parseMarkdownContent(content: string, filePath: string): ParsedOldCard;
    /**
     * 预览指定目录下的 Markdown 导入（完全只读）
     */
    preview(directoryPath: string): ImportPreviewResult;
    /**
     * 确认执行导入（幂等，不修改原文件）
     */
    execute(cards: ParsedOldCard[]): ImportExecutionResult;
}
//# sourceMappingURL=markdown.d.ts.map