import { randomUUID } from 'node:crypto';
/**
 * 宿主 SessionController 桥接（T-001/T-004 主线）。
 *
 * 真实宿主 0.2.1-rc.2 中 `@deepseek-ai/dsh-api-session-controller` 作为
 * dsh-web-app bundle 的 `session-controller` 行挂载，以 cordis Service 名
 * `sessionController` 提供（dsh-schedule 同款 inject 先例）。本桥接按公开
 * 方法面 + 形状核验后消费，不做宿主私有路径依赖；能力缺席时如实返回
 * unavailable，由调用方降级到既有路径，绝不伪造宿主回复。
 *
 * 已按宿主源码核对的形状（研究层证据，运行时再以能力探测二次确认）：
 * - createSession(request) → { agent, agentPreset }；agent.id 即 sessionId；
 * - resolveAgent(sessionId) → { agent } | { error }；
 * - prompt({sessionId, requestId, content, mode}, source) → { accepted: true }，
 *   source 形状 { kind: 'user', rpcId, clientTimeZone? }（宿主 user-rpc 源）；
 * - page({address:{kind:'session',sessionId}, throughSeq:-1, maxMessages}) →
 *   { records: [{type:'event', event}], hasMore }，事件含 user/message 与
 *   assistant 流事件；
 * - agents.selectForNextRequest(agent, selection)（可选，per-session 模型
 *   选择，不写全局默认；selection 形状 { provider, model }）。
 */
/** 解开 cordis reflect 包装（traced proxy），取原始服务实例；非包装原样返回 */
function unwrapCordisService(svc) {
    if (svc && typeof svc === 'object') {
        const orig = svc[Symbol.for('cordis.original')];
        if (orig !== undefined)
            return orig;
    }
    return svc;
}
/** 诊断面：枚举本插件关心的宿主服务与其方法面（脱敏，不含参数值） */
export function probeHostServices(ctx) {
    const names = ['sessionController', 'agents', 'sessions', 'llm', 'tools', 'systemPrompt', 'sessionPersistence'];
    const services = [];
    const reflect = ctx?.reflect;
    for (const name of names) {
        try {
            const raw = reflect && typeof reflect.get === 'function' ? reflect.get(name, false) : undefined;
            const svc = unwrapCordisService(raw);
            if (svc === undefined || svc === null) {
                services.push({ name, found: false });
                continue;
            }
            const ctor = svc?.constructor?.name ?? typeof svc;
            const proto = Object.getPrototypeOf(svc) ?? {};
            const methodNames = new Set();
            for (const m of [...Object.getOwnPropertyNames(svc), ...Object.getOwnPropertyNames(proto)]) {
                if (m === 'constructor')
                    continue;
                if (typeof svc[m] === 'function')
                    methodNames.add(m);
            }
            const methods = [...methodNames].slice(0, 30);
            services.push({ name, found: true, detail: `${ctor}(${methods.join(',')})` });
        }
        catch (err) {
            services.push({ name, found: false, detail: `probe error: ${String(err?.message ?? err)}` });
        }
    }
    return { services };
}
function extractTextFromContent(content) {
    if (!Array.isArray(content))
        return '';
    const parts = [];
    for (const part of content) {
        if (part && typeof part === 'object' && part.type === 'text') {
            const text = part.text;
            if (typeof text === 'string' && text.trim())
                parts.push(text);
        }
    }
    return parts.join('\n');
}
/** 从事件中防御性提取 assistant 文本（含 seq），形状不符时返回空数组 */
function extractAssistantMessages(records) {
    if (!Array.isArray(records))
        return [];
    const out = [];
    for (const record of records) {
        const event = DshHostSessionBridgeHelper.unwrapEventCompat(record);
        if (!event)
            continue;
        const type = String(event.type ?? '');
        if (type !== 'assistant/message')
            continue; // assistant/attempt 是尝试结算，正文在 surface 的 assistant/message
        const data = event.data;
        // 宿主形状：data.message.content（含 reasoning/text 等分块，只取 text）
        const text = extractTextFromContent(data?.message?.content ?? data?.content);
        if (text)
            out.push({ seq: typeof event.seq === 'number' ? event.seq : -1, text });
    }
    return out;
}
/** 供模块内函数使用的 unwrap 兼容（page 包装与原始事件两种形态） */
const DshHostSessionBridgeHelper = {
    unwrapEventCompat(record) {
        const r = record;
        if (r && r.type === 'event' && r.event && typeof r.event === 'object')
            return r.event;
        const e = record;
        return e && typeof e.type === 'string' ? e : undefined;
    },
};
/**
 * 能力核验通过后的宿主会话桥接。所有宿主调用都是可选形状二次确认，
 * 形状不符按 unavailable/error 如实处理。
 */
export class DshHostSessionBridge {
    controller;
    options;
    constructor(controller, options) {
        this.controller = controller;
        this.options = options;
    }
    /**
     * 能力探测：方法存在 + 关键签名形状核验。缺席或形状不符返回 null，
     * 调用方降级既有路径（严禁把降级冒充宿主路径）。
     */
    static probe(controller, options = {}) {
        // cordis reflect 返回的是 traced proxy：其代理方法调用时 this 不是服务实例，
        // 必须解开到原始实例（Symbol.for('cordis.original')），否则 this.ctx 为 undefined。
        const c = unwrapCordisService(controller);
        if (!c || typeof c !== 'object')
            return null;
        if (typeof c.prompt !== 'function')
            return null;
        if (typeof c.resolveAgent !== 'function')
            return null;
        // 宿主公开面是 create（返回 {sessionId}）；内部 createSession（{agent}）作兼容备选
        if (typeof c.create !== 'function' && typeof c.createSession !== 'function')
            return null;
        if (typeof c.page !== 'function')
            return null;
        return new DshHostSessionBridge(c, options);
    }
    async resolveAgent(sessionId) {
        const result = (await this.controller.resolveAgent(sessionId));
        if (result && result.agent !== undefined)
            return { ok: true, agent: result.agent };
        const err = result && result.error;
        return { ok: false, error: String(err?.message ?? err ?? 'resolve failed') };
    }
    /**
     * 读取会话事件。首选 resolveAgent → agent.session.snapshotEvents()（真机实证可用，
     * diagnose 同路径）；page() 因 throughSeq=-1 在宿主 paginate 中会得到空页
     * （end=min(throughSeq+1,…)=0），仅作为 snapshotEvents 缺席时的尽力回退。
     */
    /** 供诊断与跟踪服务读取会话事件 */
    async eventsOf(sessionId) {
        const resolved = await this.resolveAgent(sessionId);
        if (!resolved.ok)
            return [];
        const session = resolved.agent?.session;
        if (session && typeof session.snapshotEvents === 'function') {
            const events = session.snapshotEvents();
            if (Array.isArray(events))
                return events;
        }
        // 回退：page 需要具体 throughSeq 游标，此处以一个足够大的值试探会抛错——
        // 直接返回空并让调用方按超时/无文本如实处理，绝不编造。
        return [];
    }
    /** 兼容 unwrap：接受原始事件或 page 的 {type:'event',event} 包装记录 */
    static unwrapEventOf(record) {
        const r = record;
        if (r && r.type === 'event' && r.event && typeof r.event === 'object')
            return r.event;
        const e = record;
        return e && typeof e.type === 'string' ? e : undefined;
    }
    /** 从事件记录中提取 assistant 消息 */
    static extractAssistantMessages(records) {
        return extractAssistantMessages(records);
    }
    /** 从 assistant/attempt 的 stream finish 分块提取模型层错误（诚实诊断用） */
    static attemptErrorOf(event) {
        const stream = event.data?.stream;
        if (!Array.isArray(stream))
            return undefined;
        for (let i = stream.length - 1; i >= 0; i--) {
            const chunk = stream[i]?.chunk;
            if (chunk?.type === 'finish' && chunk.reason?.kind === 'error') {
                const msg = chunk.reason.failure?.message ?? chunk.reason.kind;
                return String(msg).slice(0, 300);
            }
        }
        return undefined;
    }
    /**
     * 绑定或创建主助理会话。既有 sessionId 先经 resolveAgent 复活/复用；
     * 不可用（含 session/not-found）才创建新会话。返回的 verified 可直接
     * 作为 rotateSession 的宿主绑定证据。
     */
    async ensureSession(currentSessionId, opts = {}) {
        if (currentSessionId) {
            const resolved = await this.resolveAgent(currentSessionId);
            if (resolved.ok) {
                // 复用也应用显式模型选择：会话可能创建于无 pin/默认路由不可用的环境，
                // selectForNextRequest 语义即为“下一次请求生效”，幂等且失败不阻断。
                await this.pinModelIfPossible(resolved.agent, opts.model);
                return { sessionId: currentSessionId, created: false, verified: true };
            }
        }
        const sessionId = await (async () => {
            if (typeof this.controller.create === 'function') {
                // 公开面：create(request) → { sessionId, agentPreset? }（workspaceId 与 cwd 互斥）
                const created = (await this.controller.create({
                    ...(opts.cwd ? { cwd: opts.cwd } : {}),
                }));
                if (typeof created?.sessionId === 'string' && created.sessionId)
                    return created.sessionId;
                // 防御：形状变化时尝试旧内部形状
                if (typeof created?.agent?.id === 'string') {
                    return created.agent.id;
                }
                throw new Error('host create did not return a usable sessionId');
            }
            // 兼容备选：内部 createSession(request) → { agent: { id } }
            const created = (await this.controller.createSession({
                ...(opts.cwd ? { cwd: opts.cwd } : {}),
            }));
            if (typeof created?.agent?.id === 'string' && created.agent.id)
                return created.agent.id;
            throw new Error('host createSession did not return a usable agent id');
        })();
        // 创建后立刻经 resolveAgent 二次确认真实可用（绑定证据，不冒充）
        const confirmed = await this.resolveAgent(sessionId);
        if (confirmed.ok)
            await this.pinModelIfPossible(confirmed.agent, opts.model);
        return { sessionId, created: true, verified: confirmed.ok, error: confirmed.ok ? undefined : confirmed.error };
    }
    /** per-session 模型选择（可选能力；绝不写全局默认，失败不阻断聊天路径） */
    async pinModelIfPossible(agent, model) {
        if (!model || !agent)
            return;
        const agentsCtl = this.controller.agents;
        if (agentsCtl && typeof agentsCtl.selectForNextRequest === 'function') {
            try {
                agentsCtl.selectForNextRequest(agent, { provider: model.provider, model: model.model });
            }
            catch {
                // 选择失败不阻断：模型不可用时宿主会以 session/model-unavailable 如实报错
            }
        }
    }
    /**
     * 发送一轮用户输入并等待宿主 agent loop 的回复文本。
     * - accepted 但超时无回复 → status 'timeout'（宿主可能仍在执行，不伪造）；
     * - 宿主拒绝/异常 → status 'error' 带原始 message；
     * - 回复提取按防御性事件扫描，形状变化时宁可 timeout 也不编造文本。
     */
    async sendAndCollect(sessionId, userText, opts = {}) {
        const requestId = opts.requestId || randomUUID();
        let baselineMaxSeq = -1;
        try {
            const before = await this.eventsOf(sessionId);
            // 基线 = 发送前全部事件的最大 seq；之后只认比它更新的 assistant 事件
            for (const record of before) {
                const event = DshHostSessionBridgeHelper.unwrapEventCompat(record);
                if (event && typeof event.seq === 'number' && event.seq > baselineMaxSeq)
                    baselineMaxSeq = event.seq;
            }
            for (const m of extractAssistantMessages(before))
                baselineMaxSeq = Math.max(baselineMaxSeq, m.seq);
        }
        catch {
            // 基线读取失败不阻断发送；此时只能以“出现任意 assistant 文本”为信号
            baselineMaxSeq = -1;
        }
        let accepted = false;
        const admission = new AbortController();
        try {
            // 宿主签名：prompt(request, signal)；source 由宿主内部从 request 构建
            // （{ kind:'user', rpcId: request.requestId, ... }），绝不自造 source 传入第二参。
            // 注意必须内联调用（保留 this 绑定），严禁先把方法提到局部变量再调。
            const res = (await this.controller.prompt({
                sessionId,
                requestId,
                content: [{ type: 'text', text: userText }],
                mode: 'followup',
                clientTimeZone: 'Asia/Shanghai',
            }, admission.signal));
            accepted = res?.accepted === true;
        }
        catch (err) {
            return {
                path: 'host-session',
                sessionId,
                status: 'error',
                error: String(err?.message ?? err),
                errorStack: String(err?.stack ?? '').slice(0, 1500),
                outcomeUnknown: true,
            };
        }
        if (!accepted) {
            return { path: 'host-session', sessionId, status: 'error', error: 'host prompt returned no acceptance' };
        }
        const timeoutMs = opts.replyTimeoutMs ?? this.options.replyTimeoutMs ?? 180_000;
        const intervalMs = this.options.pollIntervalMs ?? 1_500;
        const deadline = Date.now() + timeoutMs;
        let sawRunning = false;
        let idleRounds = 0;
        while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, intervalMs));
            const pending = opts.pending?.();
            if (pending)
                return { path: 'host-session', sessionId, requestAccepted: true, status: 'awaiting_input', replyText: pending.title };
            let agentStatus;
            try {
                const resolved = await this.resolveAgent(sessionId);
                if (resolved.ok) {
                    agentStatus = String(resolved.agent?.status ?? '');
                }
            }
            catch {
                // resolve 失败按 unknown 继续，由超时兜底
            }
            if (agentStatus === 'running')
                sawRunning = true;
            if (agentStatus === 'awaiting_input') {
                try {
                    const events = await this.eventsOf(sessionId);
                    const messages = extractAssistantMessages(events).filter((m) => m.seq > baselineMaxSeq);
                    const last = messages.length > 0 ? messages[messages.length - 1] : undefined;
                    return {
                        path: 'host-session',
                        sessionId,
                        requestAccepted: true,
                        status: 'awaiting_input',
                        replyText: last?.text || '宿主助理等待你的输入或确认。',
                    };
                }
                catch {
                    return {
                        path: 'host-session',
                        sessionId,
                        requestAccepted: true,
                        status: 'awaiting_input',
                        replyText: '宿主助理等待你的输入或确认。',
                    };
                }
            }
            if (agentStatus === 'idle') {
                idleRounds++;
                // 从未见 running：给 turn 启动留 2 轮宽限；见过 running：首轮 idle 即认为完成
                if (!sawRunning && idleRounds < 3)
                    continue;
                try {
                    const events = await this.eventsOf(sessionId);
                    const messages = extractAssistantMessages(events).filter((m) => m.seq > baselineMaxSeq);
                    if (messages.length > 0) {
                        const last = messages[messages.length - 1];
                        return { path: 'host-session', sessionId, requestAccepted: true, status: 'replied', replyText: last.text };
                    }
                    // 只有见过 running 才认定“收敛但无文本”；否则可能是轮询间隔内完成了整个回合，
                    // 需要再确认一轮基线差异，避免把尚未开始的回合误判为无文本。
                    if (sawRunning || idleRounds >= 6) {
                        // 诚实诊断：回合收敛但无正文时，从 assistant/attempt 的 finish 分块提取模型层错误
                        let modelError;
                        for (const record of events) {
                            const event = DshHostSessionBridgeHelper.unwrapEventCompat(record);
                            if (!event || event.type !== 'assistant/attempt')
                                continue;
                            if (typeof event.seq === 'number' && event.seq <= baselineMaxSeq)
                                continue;
                            const err = DshHostSessionBridge.attemptErrorOf(event);
                            if (err)
                                modelError = err;
                        }
                        return {
                            path: 'host-session',
                            sessionId,
                            requestAccepted: true,
                            status: 'accepted_no_reply_yet',
                            error: modelError
                                ? `宿主回合收敛但未产生正文；模型层错误：${modelError}`
                                : '宿主回合已收敛但未能从会话事件中提取 assistant 文本（事件形状待核对）',
                        };
                    }
                }
                catch {
                    // 事件读取失败由超时兜底
                }
            }
        }
        return {
            path: 'host-session',
            sessionId,
            requestAccepted: accepted,
            status: 'timeout',
            error: `等待宿主回复超时（${timeoutMs}ms）；宿主会话可能仍在执行，成果以宿主会话记录为准`,
        };
    }
    /** 取消宿主会话在途工作（可选能力） */
    async cancel(sessionId) {
        if (typeof this.controller.cancel !== 'function')
            return false;
        try {
            const res = (await this.controller.cancel({ sessionId }));
            return res?.accepted === true;
        }
        catch {
            return false;
        }
    }
    /**
     * 只读诊断：agent 运行状态 + 最近事件（仅 type/seq，不含正文）+ 当前模型选择。
     * 供控制条/排障使用，绝不伪造状态；形状不符的字段如实标 unknown。
     */
    async diagnose(sessionId) {
        const out = { sessionId };
        try {
            const resolved = await this.resolveAgent(sessionId);
            if (!resolved.ok) {
                out.agentStatus = 'unresolved';
                out.error = resolved.error;
                return out;
            }
            const agent = resolved.agent;
            out.agentStatus = typeof agent?.status === 'string' ? agent.status : 'unknown';
            const session = agent?.session;
            const events = typeof session?.snapshotEvents === 'function' ? session.snapshotEvents() : [];
            out.eventCount = events.length;
            out.lastEvents = events.slice(-8).map((e) => ({ seq: e.seq, type: e.type }));
            const agentsCtl = this.controller.agents;
            if (agentsCtl && typeof agentsCtl.selectionFor === 'function') {
                try {
                    out.modelSelection = agentsCtl.selectionFor(agent)?.current ?? null;
                }
                catch {
                    out.modelSelection = 'unreadable';
                }
            }
            // llm 已注册路由（只读）：确认 pin 的 provider/model 是否真的存在
            try {
                const reflect = this.controller.ctx?.llm;
                if (reflect && typeof reflect.listProviders === 'function') {
                    const providers = reflect.listProviders();
                    out.llmProviders = Array.isArray(providers)
                        ? providers.map((p) => (typeof p === 'string' ? p : JSON.stringify(p)).slice(0, 80))
                        : String(providers).slice(0, 200);
                }
            }
            catch {
                out.llmProviders = 'unreadable';
            }
        }
        catch (err) {
            out.error = String(err?.message ?? err);
        }
        return out;
    }
}
//# sourceMappingURL=host-session.js.map