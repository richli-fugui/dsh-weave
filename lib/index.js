import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openWorkbenchDb } from './host/db/database.js';
import { WorkbenchDomain } from './host/services/domain.js';
import { TaskScheduler } from './host/services/scheduler.js';
import { WorkbenchContextManager } from './host/services/context.js';
import { DshHostSessionBridge, probeHostServices } from './host/services/host-session.js';
import { HostSessionTracker } from './host/services/host-tracker.js';
import { WorkbenchInteractions } from './host/services/interactions.js';
import { LocalProvider } from './providers/local.js';
import { applyWorkbenchRelay, bindWorkbenchExtension, resolveWorkbenchMode, WORKBENCH_VERSION } from './providers/remoteconnect-relay.js';
export * from './shared/index.js';
export * from './host/services/domain.js';
export * from './host/services/scheduler.js';
export * from './host/services/context.js';
export * from './host/services/host-session.js';
export * from './host/services/host-tracker.js';
export * from './providers/types.js';
export * from './providers/local.js';
export * from './providers/remote.js';
export const name = 'workbench';
export const inject = ['webServer', 'systemPrompt', 'tools'];
export function apply(ctx, config = {}) {
    // cordis 契约：未声明 inject 的服务属性不允许通过属性访问（会抛
    // "cannot get property ... without inject"）。可选宿主服务一律经
    // ctx.reflect.get(name, false) 动态读取（免 inject 要求，缺席返回 undefined）。
    // cordis 契约：未声明 inject 的服务属性不允许属性访问（真实宿主代理会抛
    // "cannot get property ... without inject"）。读取顺序：reflect.get(name,false) 优先
    // （真实宿主实证可用）；reflect 未命中再尝试属性直取但必须独立 try 包裹——
    // 代理抛错按缺席返回 undefined（降级），普通 mock ctx 直挂的属性可正常取到。
    // 绝不允许把代理异常抛出 optionalService（2026-10-25 真实宿主曾因此炸掉 worker 整链）。
    const optionalService = (name) => {
        try {
            const reflect = ctx.reflect;
            if (reflect && typeof reflect.get === 'function') {
                const svc = reflect.get(name, false);
                if (svc !== undefined)
                    return svc;
            }
        }
        catch {
            // reflect 读取失败继续尝试属性直取
        }
        try {
            return ctx[name];
        }
        catch {
            return undefined;
        }
    };
    if (resolveWorkbenchMode(process.platform, config.mode) === 'client') {
        applyWorkbenchRelay(ctx, optionalService);
        return;
    }
    // T-001/T-004：宿主 SessionController 桥接（能力探测门控，缺席/形状不符时为 null）
    const hostSessionConfig = config.hostSession ?? {};
    const hostBridgeFor = () => hostSessionConfig.enabled === false
        ? null
        : DshHostSessionBridge.probe(optionalService('sessionController'), {
            cwd: hostSessionConfig.cwd,
            model: hostSessionConfig.model,
            replyTimeoutMs: hostSessionConfig.replyTimeoutMs,
        });
    const db = openWorkbenchDb(config);
    const domain = new WorkbenchDomain(db);
    const contextManager = new WorkbenchContextManager(domain);
    const hostTracker = new HostSessionTracker(domain, hostBridgeFor);
    const interactions = new WorkbenchInteractions(ctx, hostTracker);
    let hostDispatching = false;
    // 异步重启对账（保护已有会话状态，重启无双发）
    queueMicrotask(() => {
        hostTracker.reconcileOnStartup().catch(() => { });
    });
    // 插件卸载生命周期清理：防止后台轮询与 DB 句柄泄漏
    if (typeof ctx.on === 'function') {
        ;
        ctx.on('dispose', () => {
            hostTracker.stopBackgroundTracking();
            try {
                db.close();
            }
            catch { }
        });
    }
    /**
     * 主助理经宿主 agent loop 跑一轮：绑定/创建真实宿主会话 → prompt 准入 →
     * 收集回复与待决提问。返回 null 表示宿主路径不可用（调用方降级既有路径）；
     * 返回结果含真实 sessionId 与诚实 status，不伪造宿主回复。
     */
    const hostAssistantTurn = async (userText, focusProjectId, previousHistory, intentId) => {
        const bridge = hostBridgeFor();
        if (!bridge)
            return null;
        const pending = hostTracker.getPendingTurn();
        if (hostDispatching || pending?.stopRequested || pending?.status === 'unknown' || pending?.status === 'running') {
            return { path: 'host-session', sessionId: pending?.sessionId, status: 'error',
                error: '前一轮仍在停止或待核对，请通过控制条核验原会话；本次没有重新发送。' };
        }
        hostDispatching = true;
        let trackedRequestId;
        try {
            const controller = optionalService('sessionController');
            const state = domain.getAssistantState('main-assistant');
            // 会话工作目录：显式配置 > 聚焦项目根 > 数据目录下的 assistant-workspace
            let cwd = hostSessionConfig.cwd;
            if (!cwd && focusProjectId) {
                const project = domain.listProjects().find((p) => p.id === focusProjectId);
                if (project?.rootPath && fs.existsSync(project.rootPath))
                    cwd = project.rootPath;
            }
            if (!cwd) {
                cwd = path.join(config.dataDir || path.join(os.homedir(), '.dsh', 'workbench'), 'assistant-workspace');
                try {
                    fs.mkdirSync(cwd, { recursive: true });
                }
                catch { }
            }
            const session = await bridge.ensureSession(state.currentSessionId, {
                cwd,
                model: hostSessionConfig.model,
            });
            if (!session.verified)
                throw new Error('宿主会话未通过核验，未提交输入。');
            // 真实绑定：新建或 DB 未记录时轮换并经宿主验证（sessionMode=dsh-session-controller）
            if (session.created && session.verified && state.currentSessionId !== session.sessionId) {
                await contextManager.rotateSession('main-assistant', session.sessionId, async (id) => {
                    try {
                        const r = await controller.resolveAgent(id);
                        return !!(r && r.agent);
                    }
                    catch {
                        return false;
                    }
                }, previousHistory);
            }
            // 跟踪登记：基线事件计算并持久化 pending 状态（T-017）
            let baselineMaxSeq = -1;
            try {
                const before = await bridge.eventsOf(session.sessionId);
                for (const record of before) {
                    const event = DshHostSessionBridge.unwrapEventOf(record);
                    if (event && typeof event.seq === 'number' && event.seq > baselineMaxSeq)
                        baselineMaxSeq = event.seq;
                }
                for (const m of DshHostSessionBridge.extractAssistantMessages(before)) {
                    baselineMaxSeq = Math.max(baselineMaxSeq, m.seq);
                }
            }
            catch { }
            const tracked = hostTracker.recordTurnStarted({
                sessionId: session.sessionId,
                requestId: randomUUID(),
                intentId,
                baselineMaxSeq,
            });
            trackedRequestId = tracked.requestId;
            const turn = await bridge.sendAndCollect(session.sessionId, contextManager.buildHostTurnInput(userText, focusProjectId, previousHistory), { requestId: trackedRequestId, pending: () => interactions.pending()[0] });
            if (turn.status === 'replied') {
                hostTracker.recordTurnCompleted(turn.replyText, trackedRequestId);
            }
            else if (turn.status === 'awaiting_input') {
                await hostTracker.recordTurnAwaitingInput(turn.replyText || '宿主助理等待你的输入或确认。', undefined, trackedRequestId);
            }
            else if (turn.status === 'accepted_no_reply_yet' || turn.status === 'timeout') {
                hostTracker.startBackgroundTracking(session.sessionId, baselineMaxSeq, intentId);
            }
            else if (turn.outcomeUnknown) {
                hostTracker.recordTurnUncertain(trackedRequestId);
            }
            else {
                hostTracker.recordTurnCompleted(undefined, trackedRequestId);
            }
            return { ...turn, sessionCreated: session.created };
        }
        catch (err) {
            if (trackedRequestId)
                hostTracker.recordTurnCompleted(undefined, trackedRequestId);
            return {
                path: 'host-session',
                status: 'error',
                error: `宿主会话轮次失败: ${err?.message ?? String(err)}`,
            };
        }
        finally {
            hostDispatching = false;
        }
    };
    // Worker 仅消费宿主执行器；缺席时诚实阻塞，不另投文本模型。
    const realWorkerExecutor = async (task, projectRoot, signal, execContext) => {
        if (signal.aborted) {
            return {
                state: 'interrupted',
                summary: `任务 [${task.title}] 在启动前已收到停止信号`,
                suggestedTaskStatus: 'todo',
            };
        }
        // 严格工作区边界检查：若 projectRoot 不存在，禁止回退到 process.cwd()，明确报错阻塞
        if (!fs.existsSync(projectRoot)) {
            return {
                state: 'failed',
                summary: `项目工作区目录不存在或无法访问: [${projectRoot}]。已阻止执行，严禁回退至当前进程目录写入。`,
                suggestedTaskStatus: 'blocked',
            };
        }
        // 1. 优先调用宿主提供的 Agent 执行器（若环境已注册）
        const agentRunner = optionalService('agentRunner');
        if (agentRunner && typeof agentRunner.executeTask === 'function') {
            try {
                return await agentRunner.executeTask({
                    taskId: task.id,
                    title: task.title,
                    goal: task.goal,
                    acceptance: task.acceptance,
                    workspace: projectRoot,
                    signal,
                });
            }
            catch (err) {
                if (signal.aborted) {
                    return {
                        state: 'interrupted',
                        summary: `任务 [${task.title}] 在 Agent 执行期间被中断: ${err.message}`,
                        suggestedTaskStatus: 'todo',
                    };
                }
                return {
                    state: 'failed',
                    summary: `任务 [${task.title}] Agent 执行失败: ${err.message}`,
                    suggestedTaskStatus: 'blocked',
                };
            }
        }
        // 3. 严格规则：无可用 AI 执行环境时明确报告阻塞与失败，绝不伪造成功结果
        return {
            state: 'failed',
            summary: `无法执行任务 [${task.title}]：宿主 Agent 执行器不可用（WorkBuddy 文本桥接已按用户决定移除，Worker 宿主会话化为后续 T-002）。已明确阻塞，严禁伪造执行完成。`,
            suggestedTaskStatus: 'blocked',
        };
    };
    // 实例化真实任务调度器
    const scheduler = new TaskScheduler(domain, config.workerExecutor || realWorkerExecutor, {
        workerReconciler: config.workerReconciler,
    });
    const provider = new LocalProvider(domain, scheduler, contextManager, hostTracker);
    // 引导数据：若项目为空，植入默认工作区引导任务卡
    // 种子工作区根目录：可用 DSH_WORKBENCH_DEFAULT_ROOT 覆盖；默认取中性的用户级目录，
    // 严禁把任何个人绝对路径硬编码进源码/安装包（A18 脱敏要求）
    const seedWorkspaceRoot = process.env.DSH_WORKBENCH_DEFAULT_ROOT || path.join(os.homedir(), '.dsh', 'workbench', 'workspace');
    try {
        const existingProjects = domain.listProjects();
        if (existingProjects.length === 0) {
            try {
                fs.mkdirSync(seedWorkspaceRoot, { recursive: true });
            }
            catch { }
            const p = domain.createProject({
                id: 'proj-default',
                title: 'DSH Table 工作台施工',
                rootPath: seedWorkspaceRoot,
                goal: '完成 DSH Table 插件与单主助理入口的集成与验证',
            });
            const t1 = domain.createTask({
                id: 'task-core-arch',
                projectId: p.id,
                title: '梳理架构与领域模型',
                goal: '确立以 SQLite 为单一事实来源的模型与前向迁移',
                acceptance: '所有单测通过，支持 CAS 并发控制与无环拓扑',
                statusCode: 'done',
                priorityCode: 'high',
            });
            domain.createTask({
                id: 'task-client-view',
                projectId: p.id,
                title: '验证前端主工作台面板',
                goal: '在 DSH 桌面端呈现三栏视觉布局与主助理对话',
                acceptance: '侧栏入口正常弹出，支持拖卡引用与批量推进',
                statusCode: 'todo',
                priorityCode: 'urgent',
                dependencies: [t1.id],
            });
        }
    }
    catch {
        // ignore seed errors
    }
    // 1. 注册 HTTP 路由（供 Web / Client 使用）
    // 真实宿主（dsh-host-webserver 0.2.1-rc.2）契约：webServer.register({ kind, path, handler })，
    // handler 收到原始 node:req/res。exact 路由优先于 /api 连接网关前缀，但因此绕过网关鉴权，
    // 每个路由必须显式复用宿主 client-connection 服务的 admit 围栏；该服务缺席时仅允许回环访问。
    // registerRoute 的 get/post 回退分支仅供既有测试桩使用，真实宿主不会走到。
    const webServer = ctx.webServer;
    if (webServer && (typeof webServer.register === 'function' || typeof webServer.get === 'function')) {
        const readJsonBody = async (req) => {
            const chunks = [];
            for await (const chunk of req)
                chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
            const raw = Buffer.concat(chunks).toString('utf-8');
            if (!raw)
                return {};
            try {
                return JSON.parse(raw);
            }
            catch {
                throw new Error('请求体不是合法 JSON');
            }
        };
        const makeResApi = (rawRes) => {
            let statusCode = 200;
            const api = {
                status(code) {
                    statusCode = code;
                    return api;
                },
                json(data) {
                    if (!rawRes.headersSent)
                        rawRes.writeHead(statusCode, { 'content-type': 'application/json' });
                    rawRes.end(JSON.stringify(data));
                },
            };
            return api;
        };
        // 真实宿主路由表仅按 path 键控（不按 HTTP 方法），同 path 的 GET/POST 必须合并为
        // 单一 exact 路由并在 handler 内按 req.method 分发；先收集再统一注册。
        const collectedRoutes = [];
        const registerRoute = (method, routePath, handler) => {
            collectedRoutes.push({ method, path: routePath, handler });
        };
        const flushRoutes = () => {
            if (typeof webServer.register === 'function') {
                const byPath = new Map();
                for (const route of collectedRoutes) {
                    const entry = byPath.get(route.path) ?? {};
                    entry[route.method] = route.handler;
                    byPath.set(route.path, entry);
                }
                for (const [routePath, methods] of byPath) {
                    webServer.register({
                        kind: 'exact',
                        path: routePath,
                        handler: async (req, rawRes) => {
                            try {
                                const connection = typeof ctx.get === 'function' ? ctx.get('client-connection') : undefined;
                                if (connection && typeof connection.admit === 'function') {
                                    const admission = connection.admit(req);
                                    if (admission && 'rejection' in admission) {
                                        rawRes.writeHead(admission.rejection);
                                        rawRes.end(admission.rejection === 401 ? 'unauthorized' : 'forbidden');
                                        return;
                                    }
                                }
                                else {
                                    const peer = req.socket?.remoteAddress ?? '';
                                    const loopback = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
                                    if (!loopback) {
                                        rawRes.writeHead(403);
                                        rawRes.end('forbidden');
                                        return;
                                    }
                                }
                                const method = (req.method ?? 'GET').toUpperCase();
                                const handler = methods[method];
                                if (!handler) {
                                    rawRes.writeHead(405, { 'content-type': 'application/json' });
                                    rawRes.end(JSON.stringify({ error: `Method ${method} not allowed` }));
                                    return;
                                }
                                const url = new URL(req.url ?? '/', 'http://dsh.invalid');
                                const reqApi = {
                                    query: Object.fromEntries(url.searchParams.entries()),
                                    socket: req.socket,
                                };
                                if (method === 'POST')
                                    reqApi.body = await readJsonBody(req);
                                await handler(reqApi, makeResApi(rawRes));
                            }
                            catch (err) {
                                if (!rawRes.headersSent) {
                                    rawRes.writeHead(500, { 'content-type': 'application/json' });
                                    rawRes.end(JSON.stringify({ error: String(err?.message || err) }));
                                }
                                else {
                                    rawRes.end();
                                }
                            }
                        },
                    });
                }
            }
            else {
                // 测试桩回退：按调用逐个登记 get/post
                for (const route of collectedRoutes) {
                    if (route.method === 'GET' && typeof webServer.get === 'function')
                        webServer.get(route.path, route.handler);
                    else if (route.method === 'POST' && typeof webServer.post === 'function')
                        webServer.post(route.path, route.handler);
                }
            }
        };
        registerRoute('GET', '/api/workbench/interactions', (_req, res) => res.json({ pending: interactions.pending() }));
        registerRoute('POST', '/api/workbench/interactions/respond', (req, res) => {
            try {
                interactions.respond(req.body);
                res.json({ accepted: true });
            }
            catch (error) {
                res.status(409).json({ error: error.message });
            }
        });
        registerRoute('GET', '/api/workbench/connection', async (_req, res) => {
            const raw = optionalService('remoteconnect');
            const remote = raw?.[Symbol.for('cordis.original')] ?? raw;
            const status = typeof remote?.status === 'function' ? await remote.status() : {};
            res.json({ mode: 'host', ready: true, hostId: status.hostId || null, profile: status.profile || 'local', workbenchVersion: WORKBENCH_VERSION });
        });
        registerRoute('POST', '/api/workbench/control/abandon', (req, res) => {
            try {
                hostTracker.abandonUnknown(req.body?.expectedRequestId, req.body?.confirmed, req.body?.reason);
                res.json({ abandoned: true, terminationVerified: false });
            }
            catch (error) {
                res.status(409).json({ error: error.message });
            }
        });
        registerRoute('GET', '/api/workbench/projects', async (_req, res) => {
            res.json(await provider.listProjects());
        });
        registerRoute('POST', '/api/workbench/projects', async (req, res) => {
            try {
                const p = await provider.createProject(req.body);
                res.json(p);
            }
            catch (err) {
                res.status(400).json({ error: err.message, code: err.code });
            }
        });
        registerRoute('GET', '/api/workbench/tasks', async (req, res) => {
            res.json(await provider.listTasks(req.query?.projectId));
        });
        registerRoute('POST', '/api/workbench/tasks', async (req, res) => {
            try {
                const t = await provider.createTask(req.body);
                res.json(t);
            }
            catch (err) {
                res.status(400).json({ error: err.message, code: err.code });
            }
        });
        registerRoute('POST', '/api/workbench/tasks/update', async (req, res) => {
            try {
                const t = await provider.updateTask(req.body);
                res.json(t);
            }
            catch (err) {
                res.status(400).json({ error: err.message, code: err.code });
            }
        });
        registerRoute('GET', '/api/workbench/capabilities', async (_req, res) => {
            // 文本生成只有宿主会话一条通路（WorkBuddy 文本桥接已按用户决定移除）；
            // 无宿主桥接时如实披露不可用，绝不伪造模型能力。
            const hostBridge = hostBridgeFor();
            res.json({
                executionBackend: hostBridge ? 'host-session-controller' : 'standalone-local',
                capabilities: {
                    textGeneration: Boolean(hostBridge),
                    projectFileIO: true,
                    hostAgentSandbox: Boolean(hostBridge) || Boolean(optionalService('agentRunner')),
                    approvalPipeline: Boolean(hostBridge),
                },
                disclosed: true,
            });
        });
        // T-001/T-004 诊断面：宿主服务探测结果（脱敏，不含参数值）
        registerRoute('GET', '/api/workbench/diagnostics/host-services', async (_req, res) => {
            res.json({
                ...probeHostServices(ctx),
                hostBridgeReady: hostBridgeFor() !== null,
                hostSessionConfig: {
                    enabled: hostSessionConfig.enabled !== false,
                    modelPinned: hostSessionConfig.model ?? null,
                    cwdExplicit: hostSessionConfig.cwd ?? null,
                },
            });
        });
        // 宿主会话只读诊断：agent 状态 + 最近事件类型 + 模型选择（不含正文）
        registerRoute('GET', '/api/workbench/diagnostics/host-session', async (_req, res) => {
            try {
                const bridge = hostBridgeFor();
                if (!bridge) {
                    res.json({ available: false, reason: 'host session bridge unavailable' });
                    return;
                }
                const state = domain.getAssistantState('main-assistant');
                const sessionId = state.currentSessionId;
                if (!sessionId) {
                    res.json({ available: true, bound: false });
                    return;
                }
                res.json({ available: true, bound: true, ...(await bridge.diagnose(sessionId)) });
            }
            catch (err) {
                res.status(500).json({ error: err.message });
            }
        });
        registerRoute('POST', '/api/workbench/runs/start', async (req, res) => {
            try {
                const r = await provider.startRun(req.body);
                res.json(r);
            }
            catch (err) {
                res.status(400).json({ error: err.message, code: err.code });
            }
        });
        registerRoute('POST', '/api/workbench/runs/complete', async (req, res) => {
            try {
                const resObj = await provider.completeRun(req.body);
                res.json(resObj);
            }
            catch (err) {
                res.status(400).json({ error: err.message, code: err.code });
            }
        });
        registerRoute('GET', '/api/workbench/events', (req, res) => {
            const afterSeq = Number(req.query?.after ?? 0);
            res.json(domain.listOutboxEvents(afterSeq, 100));
        });
        registerRoute('GET', '/api/workbench/assistant', async (req, res) => {
            res.json(await provider.getAssistantState(req.query?.stableId));
        });
        registerRoute('POST', '/api/workbench/assistant/rotate', async (req, res) => {
            try {
                const { stableId, newSessionId } = req.body || {};
                const nextState = await provider.rotateAssistantSession(stableId, newSessionId);
                res.json(nextState);
            }
            catch (err) {
                res.status(500).json({ error: err.message });
            }
        });
        registerRoute('GET', '/api/workbench/context', async (req, res) => {
            const focusedProjectId = req.query?.projectId;
            const refIds = req.query?.taskIds ? String(req.query.taskIds).split(',').filter(Boolean) : [];
            const contextText = contextManager.buildBoundedContext(focusedProjectId, refIds);
            res.json({ context: contextText });
        });
        // 控制路径端点
        registerRoute('GET', '/api/workbench/control/snapshot', async (_req, res) => {
            res.json(await provider.getControlSnapshot());
        });
        registerRoute('POST', '/api/workbench/control/stop', async (req, res) => {
            try {
                const { target } = req.body || {};
                if (!target)
                    return res.status(400).json({ error: 'Missing stop target' });
                if (target.kind === 'run' && target.id) {
                    const result = await provider.stopRun(target.id);
                    return res.json(result);
                }
                else if (target.kind === 'intent' && target.id) {
                    const result = await provider.stopIntent(target.id);
                    return res.json(result);
                }
                else if (target.kind === 'all') {
                    const result = await provider.stopAll();
                    return res.json(result);
                }
                res.status(400).json({ error: 'Invalid stop target kind' });
            }
            catch (err) {
                res.status(500).json({ error: err.message });
            }
        });
        registerRoute('GET', '/api/workbench/control/uncertain', async (_req, res) => {
            res.json({ ...await provider.listUncertain(), host: hostTracker.getPendingTurn() });
        });
        registerRoute('POST', '/api/workbench/control/reconcile', async (req, res) => {
            try {
                const { runId, queueId, action, resolution, auto } = req.body || {};
                if (auto) {
                    const autoRes = await provider.autoReconcileWithWorker();
                    return res.json(autoRes);
                }
                if (runId) {
                    const state = resolution?.state || 'interrupted';
                    const summary = resolution?.summary || 'Operator manually reconciled uncertain execution';
                    const result = await provider.reconcileRun(runId, { state, summary, ...resolution });
                    return res.json(result);
                }
                if (queueId) {
                    const item = await provider.reconcileQueue(queueId, action || 'cancel');
                    return res.json({ queueItem: item });
                }
                res.status(400).json({ error: 'Missing runId or queueId to reconcile' });
            }
            catch (err) {
                res.status(400).json({ error: err.message, code: err.code });
            }
        });
        // 对话与意图处理端点
        registerRoute('GET', '/api/workbench/chat/messages', async (_req, res) => {
            res.json(await provider.listChatMessages());
        });
        registerRoute('POST', '/api/workbench/chat/send', async (req, res) => {
            try {
                const { text, projectId } = req.body || {};
                if (!text || !text.trim()) {
                    return res.status(400).json({ error: 'Empty message text' });
                }
                const userText = text.trim();
                // 1. 持久化用户消息
                const savedUserMsg = await provider.saveChatMessage('user', userText);
                // 1.1 组装所有主对话分支共享的最近历史（按消息 ID 排除刚保存的当前消息，
                // 严禁按“文本相同”误删早期同文消息；超过分页上限时取最近一批，保证最新事实不丢失）
                const allHistory = await provider.listChatMessages();
                const previousHistory = allHistory.filter((m) => m.id !== savedUserMsg.id).slice(-10);
                const buildModelMessages = (boundedContext, history) => {
                    const modelMessages = [
                        { role: 'system', content: boundedContext },
                    ];
                    for (const h of history) {
                        if (h.sender === 'user' || h.sender === 'assistant') {
                            modelMessages.push({ role: h.sender, content: h.text });
                        }
                    }
                    modelMessages.push({ role: 'user', content: userText });
                    return modelMessages;
                };
                // 2. 检查否定意图（“不要继续项目A”、“先别做A”、“暂不推进”）-> 明确不触发开工
                const isNegation = /(?:不要|别|不用|先别|暂不|不要继续|请勿)(?:继续|推进|做|开工|搞)/.test(userText);
                if (isNegation) {
                    const replyText = `已收到你的指示：暂不启动或推进相关项目工作。`;
                    const asstMsg = await provider.saveChatMessage('assistant', replyText);
                    return res.json({ reply: asstMsg });
                }
                // 3. 检查自然语言停止指令
                const stopKeywords = [
                    '停止',
                    '停止所有工作',
                    '全停',
                    '终止全部',
                    '全部停止',
                    '别做了',
                    '取消全部工作',
                    '停止当前工作',
                    '停止本次工作',
                    '停止工作',
                    '取消工作',
                    '先别做了',
                ];
                if (stopKeywords.includes(userText)) {
                    const stopRes = await provider.stopAll();
                    const replyText = stopRes.status === 'stopped'
                        ? '已确认当前工作停止，待派发队列已取消；已有成果保留。'
                        : '已请求停止并取消待派发队列，但部分工具尚未退出或执行结果待核对，不能确认全部停止。请查看控制条。';
                    const asstMsg = await provider.saveChatMessage('assistant', replyText);
                    return res.json({ reply: asstMsg, stopResult: stopRes });
                }
                // 单独停止某项任务：例如 "停止任务 task-xxx" 或 "停止 task-xxx"
                const singleStopMatch = userText.match(/^(?:停止|取消|中断)(?:任务)?[\s:：]*([a-zA-Z0-9_-]+)$/);
                if (singleStopMatch) {
                    const target = singleStopMatch[1];
                    const stopRes = await provider.stopRun(target);
                    const statusText = stopRes.status === 'stopped'
                        ? '已停止'
                        : stopRes.status === 'waiting_tool_exit'
                            ? '等待工具停稳退出'
                            : stopRes.status === 'already_terminal'
                                ? '已结束'
                                : stopRes.status === 'conflict'
                                    ? '待核对'
                                    : stopRes.status;
                    const replyText = `已针对目标 [${target}] 请求停止（${statusText}）。`;
                    const asstMsg = await provider.saveChatMessage('assistant', replyText);
                    return res.json({ reply: asstMsg, stopResult: stopRes });
                }
                // 停止指定项目下的所有工作：例如 "停止项目 proj-1" 或 "停止项目 客户调研"
                const projectStopMatch = userText.match(/^(?:停止|取消|中断)[\s:：]*项目[\s:：]*([^\s，,。！!？?]+)$/);
                if (projectStopMatch) {
                    const projName = projectStopMatch[1].trim();
                    const matchedProj = domain.listProjects().find((p) => p.id === projName || p.title.includes(projName));
                    if (matchedProj) {
                        const projTasks = domain.listTasks(matchedProj.id);
                        const stoppedTasks = [];
                        for (const t of projTasks) {
                            const res = await provider.stopRun(t.id);
                            if (res.status === 'stopped' || res.status === 'waiting_tool_exit') {
                                stoppedTasks.push(t.title);
                            }
                        }
                        const replyText = stoppedTasks.length > 0
                            ? `已针对项目【${matchedProj.title}】的 ${stoppedTasks.length} 项在途/排队任务请求停止（${stoppedTasks.slice(0, 3).join('、')}）。`
                            : `项目【${matchedProj.title}】当前没有正在执行或排队的任务。`;
                        const asstMsg = await provider.saveChatMessage('assistant', replyText);
                        return res.json({ reply: asstMsg, project: matchedProj });
                    }
                }
                // 3.5 检查是否存在待决提问（T-017：提问回答投影与统一作答）
                // 若宿主正在等待输入（awaiting_input），用户的输入直接作为对提问的作答路由回原会话
                const pendingTurn = hostTracker.getPendingTurn();
                if (pendingTurn && pendingTurn.status === 'awaiting_input') {
                    if (!interactions.pending().length)
                        throw new Error('原请求目前不能从工作台作答，请先核验；没有追加普通 Prompt。');
                    interactions.respondText(userText);
                    const answerReceipt = await provider.saveChatMessage('assistant', '已答复原请求，后台继续推进；结果将在这里更新。', pendingTurn.intentId);
                    return res.json({ reply: answerReceipt, interactionAccepted: true });
                }
                // 4. 检查方案讨论意图（“先讨论怎么推进A”、“方案是什么”）-> 引导沟通，不擅自批量开工
                const isDiscussion = /(?:讨论|如何|怎么|方案|想法|聊聊|规划|怎么推进)/.test(userText);
                if (isDiscussion && !userText.includes('@task:') && !userText.startsWith('继续')) {
                    let replyText = '';
                    // 宿主会话路径优先：真实 agent loop（含审批管线）；已准入不重复发送，不降级双发
                    const hostTurn = await hostAssistantTurn(userText, projectId, previousHistory);
                    if (hostTurn && (hostTurn.requestAccepted || hostTurn.status === 'replied' || hostTurn.status === 'awaiting_input')) {
                        if ((hostTurn.status === 'replied' || hostTurn.status === 'awaiting_input') && hostTurn.replyText) {
                            replyText = hostTurn.replyText;
                        }
                        else {
                            replyText = [
                                `已提交给宿主会话执行（会话 ${hostTurn.sessionId?.slice(0, 24)}…），后台推进中。`,
                                '完成后结果将直接呈现在此，无需切换后台会话。',
                            ].join('\n');
                        }
                    }
                    if (!replyText && hostTurn)
                        replyText = `宿主助理暂未返回答复：${hostTurn.error || hostTurn.status}。请查看当前工作状态；本次输入未转交其他模型重复执行。`;
                    if (!replyText) {
                        replyText = `关于【${userText}】，建议我们先梳理具体执行路径。您可以对我说“创建任务：...”添加规划卡片，待方案明确后再安排执行。`;
                    }
                    const asstMsg = await provider.saveChatMessage('assistant', replyText);
                    return res.json({
                        reply: asstMsg,
                        hostSession: hostTurn
                            ? { sessionId: hostTurn.sessionId, status: hostTurn.status, created: hostTurn.sessionCreated, error: hostTurn.error, errorStack: hostTurn.errorStack }
                            : undefined,
                    });
                }
                // 5. 检查显式单卡或批量推进指令（如 "@task:task-1 @task:task-2 推进"）
                const taskRefMatches = [...userText.matchAll(/@task:([a-zA-Z0-9_-]+)/g)];
                if (taskRefMatches.length > 0 && (userText.includes('推进') || userText.includes('执行') || userText.includes('开始'))) {
                    const referencedIds = taskRefMatches.map((m) => m[1]);
                    const intent = await provider.createWorkIntent(userText, projectId);
                    const startedRuns = await scheduler.dispatchBatch(referencedIds, `batch-${Date.now()}`, intent.id);
                    const replyText = `已受理批量推进要求（工作意图 ID: ${intent.id.slice(0, 8)}），已成功派发 ${startedRuns.length} 项任务，其余依赖项在排队中。可在上方控制条随时中止。`;
                    const asstMsg = await provider.saveChatMessage('assistant', replyText, intent.id);
                    return res.json({ reply: asstMsg, intent, runs: startedRuns });
                }
                // 6. 自然语言理解：“继续某项目” / 自动关联项目与就绪任务
                const continueMatch = userText.match(/^(?:继续|推进|启动|开工)[\s:：]*(?:推进)?(?:项目)?[\s:：]*([^\s，,。！!？?]+)?/);
                if (continueMatch) {
                    const allProjects = domain.listProjects();
                    const mentionedName = continueMatch[1]?.trim();
                    let matchedProject = null;
                    if (mentionedName) {
                        matchedProject = allProjects.find((p) => p.title.includes(mentionedName) || p.id === mentionedName);
                    }
                    else if (projectId) {
                        matchedProject = allProjects.find((p) => p.id === projectId);
                    }
                    // 若项目不明确，向用户发起简短澄清，绝不得随意默认选第一个！
                    if (!matchedProject) {
                        const projectOptions = allProjects.map((p) => `• 【${p.title}】 (ID: ${p.id})`).join('\n');
                        const replyText = `请问你想继续推进哪个具体项目？当前已登记项目：\n${projectOptions}\n请对我说“继续项目 <名称>”。`;
                        const asstMsg = await provider.saveChatMessage('assistant', replyText);
                        return res.json({ reply: asstMsg });
                    }
                    // 严格过滤卡片状态：只将处于 todo 状态且依赖就绪的卡片作为开工候选，绝不把 in_progress 或 review 误判为开工
                    const allTasks = domain.listTasks(matchedProject.id);
                    const todoTasks = allTasks.filter((t) => t.statusCode === 'todo');
                    const inProgressTasks = allTasks.filter((t) => t.statusCode === 'in_progress');
                    const reviewTasks = allTasks.filter((t) => t.statusCode === 'review');
                    if (todoTasks.length === 0) {
                        let replyText = `项目【${matchedProject.title}】当前没有新的待办卡片。`;
                        if (inProgressTasks.length > 0) {
                            replyText += `（已有 ${inProgressTasks.length} 项任务正在后台执行中，可通过上方控制条查看）。`;
                        }
                        else if (reviewTasks.length > 0) {
                            replyText += `（已有 ${reviewTasks.length} 项任务等待人工验收 review）。`;
                        }
                        else {
                            replyText += `（所有任务均已全部完成验收）。您可以对我说“为该项目新建任务卡：...”继续规划。`;
                        }
                        const asstMsg = await provider.saveChatMessage('assistant', replyText);
                        return res.json({ reply: asstMsg, project: matchedProject });
                    }
                    const intent = await provider.createWorkIntent(userText, matchedProject.id);
                    const taskIds = todoTasks.map((t) => t.id);
                    const startedRuns = await scheduler.dispatchBatch(taskIds, `batch-${Date.now()}`, intent.id);
                    const taskListSummary = todoTasks
                        .slice(0, 5)
                        .map((t) => `• [${t.title}] (优先级: ${t.priorityCode})`)
                        .join('\n');
                    const replyText = [
                        `已为您续接项目【${matchedProject.title}】的推进工作（意图 ID: ${intent.id.slice(0, 8)}）。`,
                        `本次调度启动了 ${startedRuns.length} 项就绪任务，排队 ${todoTasks.length - startedRuns.length} 项：`,
                        taskListSummary,
                        `任务将在工作区根目录 (${matchedProject.rootPath}) 独立执行。上方控制条实时呈现状态，随时可一键停止。`,
                    ].join('\n');
                    const asstMsg = await provider.saveChatMessage('assistant', replyText, intent.id);
                    return res.json({ reply: asstMsg, intent, runs: startedRuns, project: matchedProject });
                }
                // 7. 自然语言拆卡/建卡意图（例如“创建任务：编写测试”或“拆成任务卡：...”）
                const createTaskMatch = userText.match(/(?:创建任务|新建任务|拆卡|拆成任务卡|建个卡|添加任务)[\s:：]*(.+)/);
                if (createTaskMatch) {
                    const taskTitle = createTaskMatch[1].trim();
                    const allProjects = domain.listProjects();
                    const targetProject = (projectId && allProjects.find((p) => p.id === projectId)) || allProjects[0];
                    if (targetProject) {
                        const createdTask = await provider.createTask({
                            id: `task-${Date.now()}`,
                            projectId: targetProject.id,
                            title: taskTitle,
                            goal: userText,
                            acceptance: '待用户人工核对或自动化验证',
                            priorityCode: 'normal',
                        });
                        const replyText = `已在项目【${targetProject.title}】创建任务卡：\n• 标题：${createdTask.title}\n• ID: ${createdTask.id}\n可随时拖卡推进，或对我说“继续项目 ${targetProject.title}”启动后台执行。`;
                        const asstMsg = await provider.saveChatMessage('assistant', replyText);
                        return res.json({ reply: asstMsg, task: createdTask });
                    }
                }
                // 7.5 明确工作请求自动关联任务卡：用户直接说“帮我整理这份会议材料”这类明确工作，
                // 不应退化成泛泛的闲聊回复，也不应要求用户先手动建卡。判定保持保守（工作动词开头、
                // 有实质宾语、非疑问句），避免把闲聊批量变成活跃卡；同一标题的既有未完成卡直接复用，避免重复建卡）
                const workRequestMatch = userText.match(/^(?:帮我|请|麻烦|给我|替我)?\s*(整理|总结|汇总|起草|撰写|写|生成|分析|梳理|提炼|翻译|对比|调研|制作)(?:一下|一份|一个|份|下)?\s*(.+)$/);
                const looksLikeQuestion = /[?？]|(?:吗|么|呢)$/.test(userText);
                if (workRequestMatch && userText.length >= 10 && !looksLikeQuestion) {
                    const allProjects = domain.listProjects();
                    const targetProject = (projectId && allProjects.find((p) => p.id === projectId)) || allProjects[0];
                    if (targetProject) {
                        // 卡标题取用户原话（去掉客套前缀）的前 40 字，保留业务语义，不暴露内部派生字段
                        const taskTitle = userText.replace(/^(?:帮我|请|麻烦|给我|替我)\s*/, '').replace(/[。！!，,；;]+$/, '').slice(0, 40);
                        const reusable = domain
                            .listTasks(targetProject.id)
                            .find((t) => t.title === taskTitle && !['done', 'cancelled'].includes(t.statusCode));
                        let targetTask = reusable ??
                            (await provider.createTask({
                                id: `task-${Date.now()}`,
                                projectId: targetProject.id,
                                title: taskTitle,
                                goal: userText,
                                acceptance: '待用户人工核对或自动化验证',
                                priorityCode: 'normal',
                            }));
                        // 该卡已在本轮执行/排队中时不重复派发，避免同一张卡被重复开工
                        const busy = scheduler
                            .getControlSnapshot()
                            .items.some((i) => i.taskId === targetTask.id &&
                            ['running', 'queued', 'stopping', 'awaiting_input', 'unknown'].includes(i.state));
                        // 复用已收敛（blocked/review）的卡时，用户重提同一诉求即视为“再推进一次”，
                        // 需把卡放回待办才能进入调度；存在未决执行时 domain 会拒绝重置，此时如实告知用户
                        let resetBlocked = '';
                        if (reusable && !busy && !['todo', 'in_progress'].includes(targetTask.statusCode)) {
                            try {
                                targetTask = domain.updateTask({
                                    id: targetTask.id,
                                    expectedRevision: targetTask.revision,
                                    statusCode: 'todo',
                                });
                            }
                            catch (err) {
                                resetBlocked =
                                    err?.code === 'UNKNOWN_OUTCOME'
                                        ? '这张卡还有待核对的后台执行结果，需先在顶部控制条核对后再推进。'
                                        : `这张卡暂不能重新推进：${err?.message ?? '状态不允许'}`;
                            }
                        }
                        const autoIntent = busy || resetBlocked ? null : await provider.createWorkIntent(userText, targetProject.id);
                        const autoRuns = busy || resetBlocked || !autoIntent
                            ? []
                            : await scheduler.dispatchBatch([targetTask.id], `chat-${Date.now()}-${targetTask.id}`, autoIntent.id);
                        const replyText = [
                            reusable
                                ? `已关联项目【${targetProject.title}】的既有任务卡：${targetTask.title}`
                                : `已在项目【${targetProject.title}】自动建立任务卡：${targetTask.title}`,
                            busy
                                ? '该任务已在执行或排队中，完成后我会在这里直接汇报成果。'
                                : resetBlocked
                                    ? resetBlocked
                                    : autoRuns.length > 0
                                        ? '后台已开始执行，完成后我会在这里直接汇报成果。'
                                        : '当前队列已满，已加入待派发队列；轮到时会自动开始。',
                            '如需中止，使用顶部控制条或直接说“停止”。',
                        ].join('\n');
                        const asstMsg = await provider.saveChatMessage('assistant', replyText, autoIntent?.id);
                        return res.json({ reply: asstMsg, task: targetTask, intent: autoIntent, runs: autoRuns });
                    }
                }
                // 8. 真实主助理对话通道：宿主 SessionController（真实 agent loop）→ WorkBuddy 桥接 → 降级模板
                const intent = await provider.createWorkIntent(userText, projectId);
                let replyText = '';
                // 最近历史已在入口统一组装（previousHistory / buildModelMessages），所有分支共享
                const hostTurn = await hostAssistantTurn(userText, projectId, previousHistory, intent.id);
                if (hostTurn && (hostTurn.requestAccepted || hostTurn.status === 'replied' || hostTurn.status === 'awaiting_input')) {
                    if ((hostTurn.status === 'replied' || hostTurn.status === 'awaiting_input') && hostTurn.replyText) {
                        replyText = hostTurn.replyText;
                    }
                    else {
                        replyText = [
                            `已提交给宿主会话执行（会话 ${hostTurn.sessionId?.slice(0, 24)}…），后台推进中。`,
                            '完成后结果将直接呈现在此，无需切换后台会话。',
                        ].join('\n');
                    }
                }
                if (!replyText && hostTurn)
                    replyText = `宿主助理暂未返回答复：${hostTurn.error || hostTurn.status}。请查看当前工作状态；本次输入未转交其他模型重复执行。`;
                if (!replyText) {
                    // 基于项目与任务有界上下文生成提示
                    const allProjects = domain.listProjects();
                    const totalTasks = domain.listTasks(projectId).length;
                    const projectTitle = allProjects.find((p) => p.id === projectId)?.title || allProjects[0]?.title || '当前工作区';
                    replyText = [
                        `已收到你的指示：“${userText}”。`,
                        `当前聚焦项目：【${projectTitle}】（共登记 ${totalTasks} 张任务卡）。`,
                        `💡 建议操作：`,
                        `• 直接回复“继续项目 ${projectTitle}”推进就绪待办任务`,
                        `• 拖入或@卡片并输入“推进这些”进行定向执行`,
                        `• 输入“新建任务：...”快速添加新工作卡`,
                    ].join('\n');
                }
                const asstMsg = await provider.saveChatMessage('assistant', replyText, intent.id);
                res.json({
                    reply: asstMsg,
                    intent,
                    hostSession: hostTurn
                        ? { sessionId: hostTurn.sessionId, status: hostTurn.status, created: hostTurn.sessionCreated, error: hostTurn.error, errorStack: hostTurn.errorStack }
                        : undefined,
                });
            }
            catch (err) {
                res.status(500).json({ error: err.message });
            }
        });
        // 全部路由收集完毕：真实宿主按 path 合并注册 exact 路由，测试桩逐个登记
        flushRoutes();
        bindWorkbenchExtension(ctx, collectedRoutes, optionalService);
    }
    // 2. 注入 System Prompt 指引（动态接入有界上下文）
    // 真实宿主（dsh-system-prompt 0.2.1-rc.2）契约：section({ name, order, text })，
    // text 可为函数（每次组装 prompt 时求值），order 必须为有限数值。
    const systemPrompt = ctx.systemPrompt;
    if (systemPrompt && typeof systemPrompt.section === 'function') {
        systemPrompt.section({
            name: 'dsh-workbench-guidance',
            order: 5000,
            text: () => contextManager.buildBoundedContext(),
        });
    }
    // 3. 注册工具
    // 真实 DSH 宿主（dsh-tools 0.2.1-rc.2）契约：注册时必须声明 output { schema, render }，
    // 返回值会按 output.schema 严格校验（ToolOutputError），执行入口名为 execute 而非 handler。
    const tools = ctx.tools;
    if (tools && typeof tools.register === 'function') {
        const jsonTextOutput = (_args, value) => [
            { type: 'text', text: JSON.stringify(value, null, 2) },
        ];
        // 原始 register() 使用宿主强制的 raw JSON Schema 子集：required 只能是
        // object 节点上的属性名数组；返回值会按该 schema 严格校验。
        const projectOutputSchema = {
            type: 'object',
            additionalProperties: false,
            properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                rootPath: { type: 'string' },
                goal: { type: 'string' },
                status: { type: 'string', enum: ['active', 'archived'] },
                revision: { type: 'number' },
                createdAt: { type: 'string' },
                updatedAt: { type: 'string' },
            },
            required: ['id', 'title', 'rootPath', 'goal', 'status', 'revision', 'createdAt', 'updatedAt'],
        };
        const taskOutputSchema = {
            type: 'object',
            additionalProperties: false,
            properties: {
                id: { type: 'string' },
                projectId: { type: 'string' },
                title: { type: 'string' },
                goal: { type: 'string' },
                acceptance: { type: 'string' },
                statusCode: {
                    type: 'string',
                    enum: ['todo', 'in_progress', 'blocked', 'review', 'done', 'cancelled'],
                },
                priorityCode: {
                    type: 'string',
                    enum: ['urgent', 'high', 'normal', 'low'],
                },
                dependencies: { type: 'array', items: { type: 'string' } },
                progressPercent: { type: 'number' },
                revision: { type: 'number' },
                createdAt: { type: 'string' },
                updatedAt: { type: 'string' },
            },
            required: [
                'id', 'projectId', 'title', 'goal', 'acceptance', 'statusCode',
                'priorityCode', 'dependencies', 'progressPercent', 'revision', 'createdAt', 'updatedAt',
            ],
        };
        const runOutputSchema = {
            type: 'object',
            additionalProperties: false,
            properties: {
                id: { type: 'string' },
                taskId: { type: 'string' },
                clientRequestId: { type: 'string' },
                intentId: { type: 'string' },
                state: {
                    type: 'string',
                    enum: ['queued', 'running', 'stopping', 'awaiting_input', 'completed', 'failed', 'interrupted', 'unknown'],
                },
                workerSessionId: { type: 'string' },
                controlEpoch: { type: 'number' },
                startedAt: { type: 'string' },
                finishedAt: { type: 'string' },
                outcome: { type: 'object' },
            },
            required: ['id', 'taskId', 'clientRequestId', 'state', 'startedAt'],
        };
        const stopResultOutputSchema = {
            type: 'object',
            additionalProperties: false,
            properties: {
                commandId: { type: 'string' },
                status: {
                    type: 'string',
                    enum: ['received', 'accepted', 'stopping', 'stopped', 'already_terminal', 'conflict', 'waiting_tool_exit'],
                },
                stoppedRunIds: { type: 'array', items: { type: 'string' } },
                pendingToolIds: { type: 'array', items: { type: 'string' } },
            },
            required: ['commandId', 'status', 'stoppedRunIds'],
        };
        tools.register({
            name: 'workbench_create_task',
            description: '在指定项目中创建工作台任务卡',
            parameters: {
                type: 'object',
                properties: {
                    projectId: { type: 'string', description: '项目 ID' },
                    title: { type: 'string', description: '任务标题' },
                    goal: { type: 'string', description: '任务具体目标' },
                    acceptance: { type: 'string', description: '验收标准' },
                    priorityCode: { type: 'string', enum: ['urgent', 'high', 'normal', 'low'] },
                },
                required: ['projectId', 'title'],
            },
            output: {
                schema: taskOutputSchema,
                render: jsonTextOutput,
            },
            execute: async (args) => {
                return provider.createTask(args);
            },
        });
        tools.register({
            name: 'workbench_start_run',
            description: '为任务启动一轮执行 Run',
            parameters: {
                type: 'object',
                properties: {
                    taskId: { type: 'string', description: '任务 ID' },
                    clientRequestId: { type: 'string', description: '客户端幂等请求 ID' },
                },
                required: ['taskId', 'clientRequestId'],
            },
            output: {
                schema: runOutputSchema,
                render: jsonTextOutput,
            },
            execute: async (args) => {
                return provider.startRun(args);
            },
        });
        tools.register({
            name: 'workbench_stop',
            description: '停止指定运行中的 Run、工作意图或全部后台工作',
            parameters: {
                type: 'object',
                properties: {
                    targetKind: { type: 'string', enum: ['run', 'intent', 'all'], description: '停止目标类别' },
                    targetId: { type: 'string', description: '目标 ID（runId 或 intentId，all 时无需提供）' },
                },
                required: ['targetKind'],
            },
            output: {
                schema: stopResultOutputSchema,
                render: jsonTextOutput,
            },
            execute: async (args) => {
                if (args.targetKind === 'run' && args.targetId) {
                    return provider.stopRun(args.targetId);
                }
                else if (args.targetKind === 'intent' && args.targetId) {
                    return provider.stopIntent(args.targetId);
                }
                else if (args.targetKind === 'all') {
                    return provider.stopAll();
                }
                return { commandId: 'err', status: 'conflict', stoppedRunIds: [] };
            },
        });
        tools.register({
            name: 'workbench_list_projects',
            description: '列出工作台当前所有登记的项目及路径',
            parameters: { type: 'object', properties: {} },
            output: {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        projects: { type: 'array', items: projectOutputSchema },
                    },
                    required: ['projects'],
                },
                render: jsonTextOutput,
            },
            execute: async () => {
                return { projects: await provider.listProjects() };
            },
        });
        tools.register({
            name: 'workbench_list_tasks',
            description: '列出指定项目或全局的任务列表',
            parameters: {
                type: 'object',
                properties: {
                    projectId: { type: 'string', description: '项目 ID（可选）' },
                },
            },
            output: {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        tasks: { type: 'array', items: taskOutputSchema },
                    },
                    required: ['tasks'],
                },
                render: jsonTextOutput,
            },
            execute: async (args) => {
                return { tasks: await provider.listTasks(args?.projectId) };
            },
        });
    }
}
//# sourceMappingURL=index.js.map