import { randomUUID } from 'node:crypto';
export const RELAY_METHOD = 'workbench.api.v1';
export const WORKBENCH_VERSION = '0.1.3';
export const API_ROUTES = [
    ['GET', 'projects'], ['POST', 'projects'], ['GET', 'tasks'], ['POST', 'tasks'], ['POST', 'tasks/update'],
    ['GET', 'capabilities'], ['POST', 'runs/start'], ['GET', 'events'], ['GET', 'assistant'], ['GET', 'context'],
    ['GET', 'control/snapshot'], ['POST', 'control/stop'], ['GET', 'control/uncertain'], ['POST', 'control/reconcile'],
    ['POST', 'control/abandon'], ['GET', 'chat/messages'], ['POST', 'chat/send'], ['GET', 'interactions'], ['POST', 'interactions/respond'],
];
export function resolveWorkbenchMode(platform, mode = 'auto') {
    if (platform === 'darwin' && mode === 'host')
        throw new Error('Mac 工作台只允许连接 Windows，禁止建立本地业务权威。');
    return mode === 'auto' ? platform === 'darwin' ? 'client' : 'host' : mode;
}
/** The same authenticated local HTTP surface is used by the Windows authority and Mac relay. */
export function mountWorkbenchRoutes(ctx, routes) {
    const web = ctx.webServer;
    if (!web)
        return;
    if (typeof web.register !== 'function') {
        for (const route of routes)
            web[route.method === 'GET' ? 'get' : 'post']?.(route.path, route.handler);
        return;
    }
    for (const routePath of new Set(routes.map(route => route.path))) {
        web.register({ kind: 'exact', path: routePath, handler: async (req, res) => {
                try {
                    const connection = typeof ctx.get === 'function' ? ctx.get('client-connection') : null;
                    if (connection?.admit) {
                        const admission = connection.admit(req);
                        if (admission && 'rejection' in admission) {
                            res.writeHead(admission.rejection);
                            res.end('forbidden');
                            return;
                        }
                    }
                    else if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress)) {
                        res.writeHead(403);
                        res.end('forbidden');
                        return;
                    }
                    const route = routes.find(item => item.path === routePath && item.method === (req.method || 'GET'));
                    if (!route) {
                        res.writeHead(405);
                        res.end();
                        return;
                    }
                    const url = new URL(req.url || '/', 'http://dsh.invalid');
                    const request = { query: Object.fromEntries(url.searchParams), socket: req.socket };
                    if (route.method === 'POST') {
                        const chunks = [];
                        let size = 0;
                        for await (const chunk of req) {
                            const buffer = Buffer.from(chunk);
                            size += buffer.length;
                            if (size > 1_048_576)
                                throw new Error('请求过大');
                            chunks.push(buffer);
                        }
                        request.body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
                    }
                    let status = 200;
                    const response = { status(code) { status = code; return response; }, json(body) {
                            res.writeHead(status, { 'content-type': 'application/json' });
                            res.end(JSON.stringify(body));
                        } };
                    await route.handler(request, response);
                }
                catch (error) {
                    if (!res.headersSent) {
                        res.writeHead(500, { 'content-type': 'application/json' });
                        res.end(JSON.stringify({ error: error.message }));
                    }
                    else
                        res.end();
                }
            } });
    }
}
const unwrap = (service) => service?.[Symbol.for('cordis.original')] ?? service;
const allowed = new Set(API_ROUTES.map(([method, path]) => method + ' /api/workbench/' + path));
/** Registers one finite extension endpoint through Remote Connect's public HostServer API. */
export function bindWorkbenchExtension(ctx, routes, getService) {
    let server;
    let disposed = false;
    const bind = () => {
        const service = unwrap(getService('remoteconnect'));
        const candidate = service?.host?.server;
        if (!candidate || candidate === server || typeof candidate.registerExtensionMethod !== 'function')
            return;
        candidate.registerExtensionMethod(RELAY_METHOD, async (request) => {
            if (disposed)
                throw new Error('工作台正在重载，请重新核验连接。');
            if (!request || request.version !== 1 || !allowed.has(request.method + ' ' + request.path))
                throw new Error('Unsupported workbench endpoint');
            if (JSON.stringify(request).length > 1_048_576)
                throw new Error('请求过大');
            const route = routes.find(item => item.method === request.method && item.path === request.path);
            if (!route)
                throw new Error('Workbench endpoint not loaded');
            let status = 200;
            let body;
            const response = { status(code) { status = code; return response; }, json(value) { body = value; } };
            await route.handler({ body: request.body, query: request.query || {} }, response);
            return { version: 1, status, body };
        });
        server = candidate;
    };
    bind();
    const timer = setInterval(bind, 1000);
    timer.unref();
    ctx.on?.('dispose', () => { disposed = true; clearInterval(timer); });
}
/** Mac Node half: relay only. Does not open SQLite, seed projects, register tools or execute work. */
export function applyWorkbenchRelay(ctx, getService) {
    const identity = async () => {
        const desktop = unwrap(getService('remoteconnect'));
        const status = typeof desktop?.status === 'function' ? await desktop.status() : null;
        return { mode: 'client', ready: status?.mode === 'client' && !!status?.listener?.online && !!status?.hostId,
            hostId: status?.hostId || null, profile: status?.profile || null, generationId: status?.generationId || null,
            activeConnectionId: status?.activeConnectionId || null, workbenchVersion: WORKBENCH_VERSION };
    };
    const routes = API_ROUTES.map(([method, suffix]) => ({ method, path: '/api/workbench/' + suffix,
        handler: async (req, res) => {
            const before = await identity();
            try {
                const connector = unwrap(getService('remoteconnect_client'));
                if (!before.ready || typeof connector?.invokeExtension !== 'function')
                    throw new Error('请先在 Remote Connect 连接 Windows；Mac 不会本地执行。');
                const result = await connector.invokeExtension(RELAY_METHOD, { version: 1, method, path: '/api/workbench/' + suffix,
                    query: req.query || {}, body: req.body }, method === 'POST' ? req.body?.clientRequestId || randomUUID() : undefined);
                const after = await identity();
                if (!after.ready || before.hostId !== after.hostId || before.generationId !== after.generationId || before.activeConnectionId !== after.activeConnectionId) {
                    throw new Error('连接已变化，旧响应已丢弃；写入结果需核验，未自动重发。');
                }
                if (result?.version !== 1 || !Number.isInteger(result.status))
                    throw new Error('Windows 工作台版本不兼容，请更新 Windows 插件。');
                return res.status(result.status).json(result.body);
            }
            catch (error) {
                res.status(503).json({ error: error.message, code: method === 'POST' ? 'UNKNOWN_OUTCOME' : 'OFFLINE' });
            }
        } }));
    routes.push({ method: 'GET', path: '/api/workbench/connection', handler: async (_req, res) => res.json(await identity()) });
    mountWorkbenchRoutes(ctx, routes);
}
//# sourceMappingURL=remoteconnect-relay.js.map