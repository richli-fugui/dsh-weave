import fs from 'node:fs';
import path from 'node:path';
export class DshAIClient {
    baseURL;
    apiKey;
    model;
    timeoutMs;
    constructor(config = {}) {
        this.baseURL = config.baseURL || process.env.WORKBUDDY_BRIDGE_URL || 'http://127.0.0.1:8787/v1';
        this.model = config.model || process.env.WORKBUDDY_BRIDGE_MODEL || 'deepseek-v4.1-flash';
        this.timeoutMs = config.timeoutMs ?? 15000;
        // 解析 API Key：优先使用显式配置/环境变量，其次尝试从 ~/.dsh/.credentials.yaml 读取
        let resolvedKey = config.apiKey || process.env.WORKBUDDY_BRIDGE_API_KEY || '';
        if (!resolvedKey) {
            try {
                const homeDir = process.env.USERPROFILE || process.env.HOME || '';
                const credPath = path.join(homeDir, '.dsh', '.credentials.yaml');
                if (fs.existsSync(credPath)) {
                    const content = fs.readFileSync(credPath, 'utf-8');
                    const m = content.match(/WORKBUDDY_BRIDGE_API_KEY:\s*([^\r\n]+)/);
                    if (m && m[1].trim()) {
                        resolvedKey = m[1].trim();
                    }
                }
            }
            catch {
                // ignore
            }
        }
        this.apiKey = resolvedKey;
    }
    getBackendInfo() {
        return {
            backend: 'workbuddy-bridge',
            baseURL: this.baseURL,
            model: this.model,
            capabilities: {
                textGeneration: true,
                projectFileIO: true,
                hostAgentSandbox: false, // 明确未接入完整沙箱，仅为文本与本地工作区生成
                approvalPipeline: true,
            },
            disclosed: true,
        };
    }
    /**
     * 检查宿主 AI 桥接端点是否可用且已授权
     */
    async checkAvailability() {
        if (!this.apiKey)
            return false;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        try {
            const res = await fetch(`${this.baseURL}/models`, {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                },
                signal: controller.signal,
            });
            clearTimeout(timer);
            return res.ok;
        }
        catch {
            clearTimeout(timer);
            return false;
        }
    }
    /**
     * 调用聊天补全接口生成自然语言回复
     */
    async generateCompletion(messages, options = {}) {
        if (!this.apiKey) {
            throw new Error('宿主 AI 桥接未配置有效的 API Key (WORKBUDDY_BRIDGE_API_KEY 缺失)');
        }
        const payload = {
            model: options.model || this.model,
            messages,
            temperature: options.temperature ?? 0.3,
            max_tokens: options.maxTokens ?? 2000,
        };
        const res = await fetch(`${this.baseURL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(payload),
            signal: options.signal,
        });
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            throw new Error(`宿主 AI 模型调用失败 [HTTP ${res.status}]: ${errText || res.statusText}`);
        }
        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || !content.trim()) {
            throw new Error('宿主 AI 模型未返回有效文本内容');
        }
        return content.trim();
    }
    /**
     * 执行真实办公与业务任务（如整理会议纪要、生成交付文档等）
     * 必须真正完成用户要求并返回实际交付文本，而非元数据。
     */
    async executeOfficeTask(taskTitle, taskGoal, taskAcceptance, signal) {
        const systemPrompt = [
            '你是深度集成在 DSH 任务工作台中的执行 Agent。',
            '你的职责是根据任务目标、背景材料与验收标准，真正产出完整、严谨、格式优美、可直接交付的业务成果（如整理后的会议纪要、结构化方案、分析报告等）。',
            '严禁敷衍或仅回复元数据；严禁输出“任务已完成”之类的空话；必须输出完整的实质性业务交付物。',
        ].join('\n');
        const userPrompt = [
            `【任务标题】: ${taskTitle}`,
            `【任务目标与原始输入】:`,
            taskGoal,
            taskAcceptance ? `【验收标准要求】:\n${taskAcceptance}` : '',
            '请根据上述内容，直接输出整理完成后的业务成果交付正文：',
        ].filter(Boolean).join('\n\n');
        const content = await this.generateCompletion([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ], { signal });
        // 严谨校验成果与验收指标：不仅检查长度，还校验验收标准中的各项要素是否真实存在
        let acceptanceMet = false;
        const isRefusal = content.includes('对不起') || content.includes('无法完成') || content.includes('抱歉，我不能');
        if (content.length >= 50 && !isRefusal) {
            if (!taskAcceptance || !taskAcceptance.trim()) {
                acceptanceMet = false; // 未明确验收标准的主观事项保持待确认
            }
            else {
                // 拆分各项验收指标
                const acceptanceRequirements = taskAcceptance
                    .split(/[,，;；\n]/)
                    .map((s) => s.trim())
                    .filter((s) => s.length > 0);
                // 检查是否包含主观验收词汇（如“人工核验”、“视觉满意”、“按需定稿”等），此类需保持 review 待确认
                const hasSubjectiveClause = acceptanceRequirements.some((req) => /(?:人工|主观|定稿|确认|审查|核验|视觉|满意|待定)/.test(req));
                if (hasSubjectiveClause) {
                    acceptanceMet = false;
                }
                else if (acceptanceRequirements.length > 0) {
                    // 客观验收标准：必须严格在内容中找到对应关键词或核心要点，绝不以字符长度充数
                    const allMet = acceptanceRequirements.every((req) => {
                        // 提取核心关键词（移除助词或标点前缀）
                        const cleaned = req.replace(/^.*?(?:必须包含|要求包含|需包含|包含|需有|要有|必须|需)/, '').trim() || req;
                        // 分解连词（如“决议与待办事项列表” -> [“决议”, “待办事项”]）
                        const subParts = cleaned
                            .split(/[与和及、]/)
                            .map((s) => s.replace(/(?:列表|清单|结构|要点)$/, '').trim())
                            .filter(Boolean);
                        if (subParts.length === 0)
                            return content.includes(cleaned);
                        return subParts.every((part) => content.includes(part));
                    });
                    acceptanceMet = allMet;
                }
            }
        }
        return {
            content,
            acceptanceMet,
            summary: `已由真实执行 Agent 完成 [${taskTitle}]，生成了 ${content.length} 字的业务交付成果。`,
        };
    }
}
//# sourceMappingURL=ai-client.js.map