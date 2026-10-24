import { randomUUID } from 'node:crypto';
import { WorkbenchError, UnknownOutcomeError } from '../shared/errors.js';
/**
 * 工作台与 Remote Connect 之间的公共契约版本（docs/REMOTECONNECT_CONTRACT.md / dsh-remoteconnect WORKBENCH_INTEGRATION.md）。
 * 当前双方文件均为 0.1-draft 草案；本常量随联合契约冻结而更新。
 */
export const WORKBENCH_REMOTE_CONTRACT_VERSION = '0.1-draft';
const CONTRACT_FAMILY = WORKBENCH_REMOTE_CONTRACT_VERSION.split('-')[0];
/**
 * 同族契约（如 0.1-draft / 0.1-rc2）视为兼容；对端显式声明不同族版本时必须硬阻塞，
 * 严禁静默降级到 Mac 本地执行（契约错误与版本一节）。
 */
export function isContractCompatible(version) {
    if (!version)
        return false;
    return version.split('-')[0] === CONTRACT_FAMILY;
}
/**
 * 把适配器抛出的 wire 错误映射为契约错误分类。
 * 识别顺序：显式 code/wireCode → 消息启发式；无法识别时保守归为 DOMAIN_ERROR，
 * 绝不把无法解释的结果当作成功或未执行。
 */
export function mapWireError(err) {
    if (err instanceof WorkbenchError)
        return err;
    const anyErr = err;
    const code = (anyErr?.code || anyErr?.wireCode || '').toUpperCase();
    const message = String(anyErr?.message ?? err ?? 'remote call failed');
    switch (code) {
        case 'AUTH_REQUIRED':
        case 'AUTHREQUIRED':
            return new WorkbenchError(message, 'AUTH_REQUIRED');
        case 'OFFLINE':
            return new WorkbenchError(message, 'OFFLINE');
        case 'UNSUPPORTED_VERSION':
            return new WorkbenchError(message, 'UNSUPPORTED_VERSION');
        case 'UNSUPPORTED_CAPABILITY':
        case 'UNSUPPORTEDCAPABILITY':
            return new WorkbenchError(message, 'UNSUPPORTED_CAPABILITY');
        case 'CONFLICT':
            return new WorkbenchError(message, 'CONFLICT');
        case 'UNKNOWN_OUTCOME':
        case 'UNKNOWNOUTCOME':
            return new UnknownOutcomeError(message);
        case 'CANCELLED':
            return new WorkbenchError(message, 'CANCELLED');
    }
    if (/unknown endpoint|not registered|no such endpoint|unsupported capability/i.test(message)) {
        return new WorkbenchError(message, 'UNSUPPORTED_CAPABILITY');
    }
    if (/conflict|revision/i.test(message)) {
        return new WorkbenchError(message, 'CONFLICT');
    }
    return new WorkbenchError(message, 'DOMAIN_ERROR');
}
/**
 * RemoteProvider：Mac Client 侧消费 Windows 工作台 Domain 的统一入口。
 * 契约要点（0.1-draft）：
 * - 首次使用前向对端协商身份与契约版本；显式声明不兼容版本时硬阻塞（UNSUPPORTED_VERSION）；
 *   对端未实现身份端点（如纯 stub）时进入“未验证兼容模式”并如实标注，不冒充已验证。
 * - 所有写命令自动注入 clientRequestId（调用方已提供时保留原值），副作用幂等对账由该 ID 承载。
 * - 连接 generation 变化：立即失效旧 follow 订阅，作废已协商身份，下一次调用重新协商；
 *   不把旧 generation 的异步响应当作当前事实。
 * - 错误按契约词表分类透出；不自动重发非幂等写操作。
 */
export class RemoteProvider {
    connection;
    identity = null;
    identityVerified = false;
    negotiatedInCompatMode = false;
    lastGeneration = null;
    generationCounter = 0;
    activeFollows = new Set();
    generationDisposer;
    constructor(connection) {
        this.connection = connection;
        if (typeof connection.onGenerationChange === 'function') {
            try {
                this.generationDisposer = connection.onGenerationChange((gen) => this.invalidateOnGeneration(gen));
            }
            catch {
                this.generationDisposer = null;
            }
        }
        else {
            this.generationDisposer = null;
        }
    }
    /** 当前协商结果；identityVerified=false 表示对端未声明身份（未验证兼容模式） */
    getIdentity() {
        return { identity: this.identity, verified: this.identityVerified, compatMode: this.negotiatedInCompatMode };
    }
    /**
     * 向对端协商身份与契约版本。对端显式声明不兼容版本 → UNSUPPORTED_VERSION 硬阻塞；
     * 对端未实现身份端点（UNSUPPORTED_CAPABILITY 且未声明版本）→ 未验证兼容模式，如实标注。
     */
    async negotiate() {
        const callGen = this.generationCounter;
        const raw = await this.connection.invoke('workbench.identity.get', {
            clientContractVersion: WORKBENCH_REMOTE_CONTRACT_VERSION,
        });
        if (this.generationCounter !== callGen) {
            throw new WorkbenchError('Identity negotiation was invalidated by a connection generation change in flight', 'CANCELLED');
        }
        if (!raw || typeof raw !== 'object' || !raw.hostId) {
            throw new WorkbenchError('Remote peer did not return a valid workbench identity payload', 'UNSUPPORTED_CAPABILITY');
        }
        if (!isContractCompatible(raw.workbenchContractVersion)) {
            throw new WorkbenchError(`Remote peer workbench contract version '${raw.workbenchContractVersion ?? 'unspecified'}' is incompatible with client '${WORKBENCH_REMOTE_CONTRACT_VERSION}'`, 'UNSUPPORTED_VERSION');
        }
        this.identity = raw;
        this.identityVerified = true;
        this.negotiatedInCompatMode = false;
        return raw;
    }
    async ensureNegotiated() {
        if (this.identityVerified)
            return;
        try {
            await this.negotiate();
        }
        catch (err) {
            const mapped = mapWireError(err);
            if (mapped.code === 'UNSUPPORTED_VERSION')
                throw mapped;
            if (mapped.code === 'UNSUPPORTED_CAPABILITY') {
                // 对端明确未实现身份端点（典型：旧 stub/未升级对端）：进入未验证兼容模式，如实标注，不冒充已验证
                this.identity = null;
                this.identityVerified = true;
                this.negotiatedInCompatMode = true;
                return;
            }
            // 其他一般性后端或网络错误（DOMAIN_ERROR, OFFLINE, AUTH_REQUIRED 等）禁止静默进入兼容模式，必须阻断
            throw mapped;
        }
    }
    checkReady() {
        // 契约要求 auth_required 与 offline 严格区分：状态为 auth_required 时即使底层链路 ready 也必须阻塞
        const state = typeof this.connection.getState === 'function' ? this.connection.getState() : undefined;
        if (state === 'auth_required') {
            throw new WorkbenchError('Remote connection requires authentication (auth_required)', 'AUTH_REQUIRED');
        }
        if (this.connection.isReady())
            return;
        throw new WorkbenchError('Remote connection to Windows DSH host is offline or not ready', 'OFFLINE');
    }
    async invokeDomain(endpoint, payload) {
        this.checkReady();
        await this.ensureNegotiated();
        const callGen = this.generationCounter;
        try {
            const res = await this.connection.invoke(endpoint, payload);
            if (this.generationCounter !== callGen) {
                const isWrite = typeof payload === 'object' && payload !== null && 'clientRequestId' in payload;
                if (isWrite) {
                    throw new UnknownOutcomeError(`Connection generation changed during write request '${endpoint}'; outcome is unknown`);
                }
                throw new WorkbenchError(`Response for '${endpoint}' rejected because connection generation changed while request was in-flight`, 'CANCELLED');
            }
            return res;
        }
        catch (err) {
            if (err instanceof WorkbenchError)
                throw err;
            if (this.generationCounter !== callGen) {
                const isWrite = typeof payload === 'object' && payload !== null && 'clientRequestId' in payload;
                if (isWrite) {
                    throw new UnknownOutcomeError(`Connection generation changed during write request '${endpoint}' failure; outcome is unknown`);
                }
            }
            throw mapWireError(err);
        }
    }
    /** 写命令幂等：调用方已带 clientRequestId 时保留，否则生成（契约：所有写命令带 clientRequestId） */
    withClientRequestId(payload) {
        const existing = payload.clientRequestId;
        return { ...payload, clientRequestId: existing || randomUUID() };
    }
    invalidateOnGeneration(generation) {
        if (this.lastGeneration !== null && generation === this.lastGeneration)
            return;
        this.lastGeneration = generation;
        this.generationCounter++;
        // 契约：失效旧异步响应；重建 follow 订阅由消费方在重新协商后进行
        for (const dispose of this.activeFollows) {
            try {
                dispose();
            }
            catch { }
        }
        this.activeFollows.clear();
        this.identity = null;
        this.identityVerified = false;
        this.negotiatedInCompatMode = false;
    }
    async createWorkIntent(rawInput, projectId) {
        return this.invokeDomain('workbench.intents.create', this.withClientRequestId({ rawInput, projectId }));
    }
    async getControlSnapshot() {
        return this.invokeDomain('workbench.control.snapshot', {});
    }
    async stopRun(runId) {
        return this.invokeDomain('workbench.control.stopRun', this.withClientRequestId({ runId }));
    }
    async stopIntent(intentId) {
        return this.invokeDomain('workbench.control.stopIntent', this.withClientRequestId({ intentId }));
    }
    async stopAll() {
        return this.invokeDomain('workbench.control.stopAll', this.withClientRequestId({}));
    }
    async listUncertain() {
        return this.invokeDomain('workbench.control.uncertain', {});
    }
    async reconcileRun(runId, resolution) {
        return this.invokeDomain('workbench.control.reconcileRun', this.withClientRequestId({ runId, ...resolution }));
    }
    async reconcileQueue(queueId, action = 'cancel') {
        return this.invokeDomain('workbench.control.reconcileQueue', this.withClientRequestId({ queueId, action }));
    }
    async saveChatMessage(sender, text, intentId) {
        return this.invokeDomain('workbench.chat.save', this.withClientRequestId({ sender, text, intentId }));
    }
    async listChatMessages() {
        return this.invokeDomain('workbench.chat.list', {});
    }
    async listProjects() {
        return this.invokeDomain('workbench.projects.list', {});
    }
    async getProject(id) {
        return this.invokeDomain('workbench.projects.get', { id });
    }
    async createProject(input) {
        return this.invokeDomain('workbench.projects.create', this.withClientRequestId(input));
    }
    async updateProject(input) {
        return this.invokeDomain('workbench.projects.update', this.withClientRequestId(input));
    }
    async listTasks(projectId) {
        return this.invokeDomain('workbench.tasks.list', { projectId });
    }
    async getTask(id) {
        return this.invokeDomain('workbench.tasks.get', { id });
    }
    async createTask(input) {
        return this.invokeDomain('workbench.tasks.create', this.withClientRequestId(input));
    }
    async updateTask(input) {
        return this.invokeDomain('workbench.tasks.update', this.withClientRequestId(input));
    }
    async startRun(input) {
        // StartRunInput.clientRequestId 是必填业务键，原样透传，不覆盖
        return this.invokeDomain('workbench.runs.start', { ...input });
    }
    async completeRun(input) {
        return this.invokeDomain('workbench.runs.complete', this.withClientRequestId(input));
    }
    async getRun(id) {
        return this.invokeDomain('workbench.runs.get', { id });
    }
    async listRuns(taskId) {
        return this.invokeDomain('workbench.runs.list', { taskId });
    }
    async getResult(id) {
        return this.invokeDomain('workbench.results.get', { id });
    }
    async getAssistantState(stableId) {
        return this.invokeDomain('workbench.assistant.get', { stableId });
    }
    async rotateAssistantSession(stableId, newSessionId) {
        return this.invokeDomain('workbench.assistant.rotate', this.withClientRequestId({ stableId, newSessionId }));
    }
    /**
     * 订阅领域事件流。契约要求 baseline + sequence/delta 语义：
     * 本方法按 sequence 去重与单调推进（重复/回退投递不重复回调），generation 变化时自动失效。
     */
    followEvents(afterSequence, callback) {
        this.checkReady();
        // 协商异步进行；订阅立即建立，身份结论随后生效（离线/版本不兼容会在下一次 invoke 时硬阻塞）
        void this.ensureNegotiated().catch(() => { });
        let maxSequence = afterSequence;
        const subGen = this.generationCounter;
        const onData = (event) => {
            if (this.generationCounter !== subGen)
                return; // generation 变化后丢弃旧流事件
            if (!event || typeof event.sequence !== 'number')
                return;
            if (event.sequence <= maxSequence)
                return; // 重复或回退投递：丢弃，不重复回调
            maxSequence = event.sequence;
            callback(event);
        };
        const dispose = this.connection.follow('workbench.events.follow', { afterSequence, clientContractVersion: WORKBENCH_REMOTE_CONTRACT_VERSION }, onData);
        const tracked = () => {
            try {
                dispose();
            }
            catch { }
            this.activeFollows.delete(tracked);
        };
        this.activeFollows.add(tracked);
        return tracked;
    }
}
//# sourceMappingURL=remote.js.map