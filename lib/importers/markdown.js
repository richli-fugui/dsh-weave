import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
export class MarkdownCardImporter {
    domain;
    constructor(domain) {
        this.domain = domain;
    }
    /**
     * 解析单张 Markdown 卡片内容（只读）
     */
    parseMarkdownContent(content, filePath) {
        const lines = content.split(/\r?\n/);
        let id = '';
        let title = '';
        let project = 'default';
        let projectRoot = '';
        let status = 'Ready';
        let blockedBy = [];
        let priority = 50;
        const legacySessions = {};
        let inYaml = false;
        let yamlLines = [];
        let bodyStartIndex = 0;
        // 检查 YAML frontmatter
        if (lines[0]?.trim() === '---') {
            inYaml = true;
            for (let i = 1; i < lines.length; i++) {
                if (lines[i].trim() === '---') {
                    inYaml = false;
                    bodyStartIndex = i + 1;
                    break;
                }
                yamlLines.push(lines[i]);
            }
        }
        if (yamlLines.length > 0) {
            for (const line of yamlLines) {
                const colonIdx = line.indexOf(':');
                if (colonIdx === -1)
                    continue;
                const key = line.slice(0, colonIdx).trim().toLowerCase();
                const val = line.slice(colonIdx + 1).trim();
                if (key === 'id')
                    id = val;
                else if (key === 'title')
                    title = val;
                else if (key === 'project')
                    project = val;
                else if (key === 'project_root' || key === 'projectroot')
                    projectRoot = val;
                else if (key === 'status')
                    status = val;
                else if (key === 'priority')
                    priority = parseInt(val, 10) || 50;
                else if (key === 'blocked_by' || key === 'blockedby') {
                    const raw = val.replace(/^\[|\]$/g, '').trim();
                    if (raw) {
                        blockedBy = raw.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
                    }
                }
            }
        }
        // 提取正文中的 Goal 与 Acceptance
        const bodyText = lines.slice(bodyStartIndex).join('\n');
        let goal = '';
        let acceptance = '';
        const goalMatch = bodyText.match(/## Goal\s*([\s\S]*?)(?=##|$)/i);
        if (goalMatch)
            goal = goalMatch[1].trim();
        const accMatch = bodyText.match(/## Acceptance\s*([\s\S]*?)(?=##|$)/i);
        if (accMatch)
            acceptance = accMatch[1].trim();
        if (!id) {
            // 降级从文件名获取
            const base = filePath.split(/[\\/]/).pop() || '';
            id = base.replace(/\.md$/i, '');
        }
        if (!title) {
            title = id;
        }
        return {
            id,
            title,
            project,
            projectRoot,
            status,
            blockedBy,
            priority,
            goal,
            acceptance,
            legacySessions,
            filePath,
        };
    }
    /**
     * 预览指定目录下的 Markdown 导入（完全只读）
     */
    preview(directoryPath) {
        const files = readdirSync(directoryPath).filter((f) => f.endsWith('.md'));
        const newCards = [];
        const duplicateCards = [];
        const invalidCards = [];
        // 获取当前已有任务 ID 集合
        const existingTasks = this.domain.listTasks();
        const existingIds = new Set(existingTasks.map((t) => t.id));
        for (const file of files) {
            const fullPath = join(directoryPath, file);
            try {
                const stat = statSync(fullPath);
                if (!stat.isFile())
                    continue;
                const content = readFileSync(fullPath, 'utf8');
                const parsed = this.parseMarkdownContent(content, fullPath);
                if (existingIds.has(parsed.id)) {
                    duplicateCards.push({
                        id: parsed.id,
                        title: parsed.title,
                        reason: 'Task with identical ID already exists in workbench SQLite database',
                    });
                }
                else {
                    newCards.push(parsed);
                }
            }
            catch (err) {
                invalidCards.push({ filePath: fullPath, reason: err.message });
            }
        }
        return {
            totalScanned: files.length,
            newCards,
            duplicateCards,
            invalidCards,
        };
    }
    /**
     * 确认执行导入（幂等，不修改原文件）
     */
    execute(cards) {
        let importedCount = 0;
        let skippedCount = 0;
        const importedIds = [];
        // 建立/查找项目映射
        const existingProjects = this.domain.listProjects();
        const projectMap = new Map();
        for (const p of existingProjects) {
            projectMap.set(p.title, p.id);
        }
        for (const card of cards) {
            // 1. 获取或创建关联项目
            let projectId = projectMap.get(card.project);
            if (!projectId) {
                const newProj = this.domain.createProject({
                    title: card.project,
                    rootPath: card.projectRoot || 'C:\\',
                    goal: `Imported from ArthurOS project ${card.project}`,
                });
                projectId = newProj.id;
                projectMap.set(card.project, projectId);
            }
            // 2. 映射状态
            let statusCode = 'todo';
            const s = card.status.toLowerCase();
            if (s === 'done')
                statusCode = 'done';
            else if (s === 'active' || s === 'in_progress')
                statusCode = 'in_progress';
            else if (s === 'cancelled')
                statusCode = 'cancelled';
            // 3. 映射优先级
            let priorityCode = 'normal';
            if (card.priority >= 80)
                priorityCode = 'urgent';
            else if (card.priority >= 60)
                priorityCode = 'high';
            else if (card.priority <= 20)
                priorityCode = 'low';
            try {
                this.domain.createTask({
                    id: card.id,
                    projectId,
                    title: card.title,
                    goal: card.goal,
                    acceptance: card.acceptance,
                    statusCode,
                    priorityCode,
                    dependencies: card.blockedBy,
                });
                importedCount++;
                importedIds.push(card.id);
            }
            catch (err) {
                // 如果重复或主键冲突则跳过，保持幂等
                skippedCount++;
            }
        }
        return {
            importedCount,
            skippedCount,
            importedIds,
        };
    }
}
//# sourceMappingURL=markdown.js.map