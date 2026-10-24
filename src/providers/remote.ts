import { randomUUID } from 'node:crypto'
import { WorkbenchError, UnknownOutcomeError } from '../shared/errors.js'
import type {
  AssistantState,
  ChatMessage,
  CompleteRunInput,
  ControlSnapshot,
  CreateProjectInput,
  CreateTaskInput,
  OutboxEvent,
  Project,
  Result,
  Run,
  StartRunInput,
  StopResult,
  Task,
  UpdateProjectInput,
  UpdateTaskInput,
  WorkIntent,
} from '../shared/types.js'
import type { WorkbenchProvider } from './types.js'

/**
 * 工作台与 Remote Connect 之间的公共契约版本（docs/REMOTECONNECT_CONTRACT.md / dsh-remoteconnect WORKBENCH_INTEGRATION.md）。
 * 当前双方文件均为 0.1-draft 草案；本常量随联合契约冻结而更新。
 */
export const WORKBENCH_REMOTE_CONTRACT_VERSION = '0.1-draft'

/** 连接层状态（契约拟定词表；仅识别，不发明新状态） */
export type RemoteConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'auth_required'
  | 'ready'
  | 'recovering'
  | 'error'

/** 对端身份（契约拟定字段；实现对齐后由生成类型核对，当前为逻辑契约） */
export interface RemoteIdentity {
  hostId: string
  profileId?: string
  dshVersion?: string
  connectionProtocolVersion?: string
  serverEpoch?: string | number
  workbenchContractVersion?: string
  capabilities?: string[]
}

export interface RemoteConnectionAdapter {
  connectionId: string
  isReady(): boolean
  invoke<T>(endpoint: string, payload: unknown): Promise<T>
  follow(endpoint: string, payload: unknown, onData: (data: any) => void): () => void
  /** 可选：连接层状态词表（区分 auth_required 与 offline，契约要求不得混同） */
  getState?(): RemoteConnectionState
  /** 可选：连接 generation 变化通知（重连/换载体）；提供时 RemoteProvider 据此失效旧响应并重建订阅 */
  onGenerationChange?(callback: (generation: number) => void): () => void
}

const CONTRACT_FAMILY = WORKBENCH_REMOTE_CONTRACT_VERSION.split('-')[0]

/**
 * 同族契约（如 0.1-draft / 0.1-rc2）视为兼容；对端显式声明不同族版本时必须硬阻塞，
 * 严禁静默降级到 Mac 本地执行（契约错误与版本一节）。
 */
export function isContractCompatible(version: string | undefined | null): boolean {
  if (!version) return false
  return version.split('-')[0] === CONTRACT_FAMILY
}

/** 错误分类（契约要求最少区分的词表，作为 WorkbenchError.code 透出） */
export type RemoteErrorCode =
  | 'AUTH_REQUIRED'
  | 'OFFLINE'
  | 'UNSUPPORTED_VERSION'
  | 'UNSUPPORTED_CAPABILITY'
  | 'CONFLICT'
  | 'UNKNOWN_OUTCOME'
  | 'CANCELLED'
  | 'DOMAIN_ERROR'

/**
 * 把适配器抛出的 wire 错误映射为契约错误分类。
 * 识别顺序：显式 code/wireCode → 消息启发式；无法识别时保守归为 DOMAIN_ERROR，
 * 绝不把无法解释的结果当作成功或未执行。
 */
export function mapWireError(err: unknown): WorkbenchError {
  if (err instanceof WorkbenchError) return err
  const anyErr = err as { code?: string; wireCode?: string; message?: string } | null
  const code = (anyErr?.code || anyErr?.wireCode || '').toUpperCase()
  const message = String(anyErr?.message ?? err ?? 'remote call failed')
  switch (code) {
    case 'AUTH_REQUIRED':
    case 'AUTHREQUIRED':
      return new WorkbenchError(message, 'AUTH_REQUIRED')
    case 'OFFLINE':
      return new WorkbenchError(message, 'OFFLINE')
    case 'UNSUPPORTED_VERSION':
      return new WorkbenchError(message, 'UNSUPPORTED_VERSION')
    case 'UNSUPPORTED_CAPABILITY':
    case 'UNSUPPORTEDCAPABILITY':
      return new WorkbenchError(message, 'UNSUPPORTED_CAPABILITY')
    case 'CONFLICT':
      return new WorkbenchError(message, 'CONFLICT')
    case 'UNKNOWN_OUTCOME':
    case 'UNKNOWNOUTCOME':
      return new UnknownOutcomeError(message)
    case 'CANCELLED':
      return new WorkbenchError(message, 'CANCELLED')
  }
  if (/unknown endpoint|not registered|no such endpoint|unsupported capability/i.test(message)) {
    return new WorkbenchError(message, 'UNSUPPORTED_CAPABILITY')
  }
  if (/conflict|revision/i.test(message)) {
    return new WorkbenchError(message, 'CONFLICT')
  }
  return new WorkbenchError(message, 'DOMAIN_ERROR')
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
export class RemoteProvider implements WorkbenchProvider {
  private identity: RemoteIdentity | null = null
  private identityVerified = false
  private negotiatedInCompatMode = false
  private lastGeneration: number | null = null
  private generationCounter = 0
  private readonly activeFollows = new Set<() => void>()
  private readonly generationDisposer: (() => void) | null

  constructor(private readonly connection: RemoteConnectionAdapter) {
    if (typeof connection.onGenerationChange === 'function') {
      try {
        this.generationDisposer = connection.onGenerationChange((gen) => this.invalidateOnGeneration(gen))
      } catch {
        this.generationDisposer = null
      }
    } else {
      this.generationDisposer = null
    }
  }

  /** 当前协商结果；identityVerified=false 表示对端未声明身份（未验证兼容模式） */
  getIdentity(): { identity: RemoteIdentity | null; verified: boolean; compatMode: boolean } {
    return { identity: this.identity, verified: this.identityVerified, compatMode: this.negotiatedInCompatMode }
  }

  /**
   * 向对端协商身份与契约版本。对端显式声明不兼容版本 → UNSUPPORTED_VERSION 硬阻塞；
   * 对端未实现身份端点（UNSUPPORTED_CAPABILITY 且未声明版本）→ 未验证兼容模式，如实标注。
   */
  async negotiate(): Promise<RemoteIdentity> {
    const callGen = this.generationCounter
    const raw = await this.connection.invoke<RemoteIdentity>('workbench.identity.get', {
      clientContractVersion: WORKBENCH_REMOTE_CONTRACT_VERSION,
    })
    if (this.generationCounter !== callGen) {
      throw new WorkbenchError(
        'Identity negotiation was invalidated by a connection generation change in flight',
        'CANCELLED',
      )
    }
    if (!raw || typeof raw !== 'object' || !raw.hostId) {
      throw new WorkbenchError(
        'Remote peer did not return a valid workbench identity payload',
        'UNSUPPORTED_CAPABILITY',
      )
    }
    if (!isContractCompatible(raw.workbenchContractVersion)) {
      throw new WorkbenchError(
        `Remote peer workbench contract version '${raw.workbenchContractVersion ?? 'unspecified'}' is incompatible with client '${WORKBENCH_REMOTE_CONTRACT_VERSION}'`,
        'UNSUPPORTED_VERSION',
      )
    }
    this.identity = raw
    this.identityVerified = true
    this.negotiatedInCompatMode = false
    return raw
  }

  private async ensureNegotiated(): Promise<void> {
    if (this.identityVerified) return
    try {
      await this.negotiate()
    } catch (err) {
      const mapped = mapWireError(err)
      if (mapped.code === 'UNSUPPORTED_VERSION') throw mapped
      if (mapped.code === 'UNSUPPORTED_CAPABILITY') {
        // 对端明确未实现身份端点（典型：旧 stub/未升级对端）：进入未验证兼容模式，如实标注，不冒充已验证
        this.identity = null
        this.identityVerified = true
        this.negotiatedInCompatMode = true
        return
      }
      // 其他一般性后端或网络错误（DOMAIN_ERROR, OFFLINE, AUTH_REQUIRED 等）禁止静默进入兼容模式，必须阻断
      throw mapped
    }
  }

  private checkReady(): void {
    // 契约要求 auth_required 与 offline 严格区分：状态为 auth_required 时即使底层链路 ready 也必须阻塞
    const state = typeof this.connection.getState === 'function' ? this.connection.getState() : undefined
    if (state === 'auth_required') {
      throw new WorkbenchError('Remote connection requires authentication (auth_required)', 'AUTH_REQUIRED')
    }
    if (this.connection.isReady()) return
    throw new WorkbenchError('Remote connection to Windows DSH host is offline or not ready', 'OFFLINE')
  }

  private async invokeDomain<T>(endpoint: string, payload: unknown): Promise<T> {
    this.checkReady()
    await this.ensureNegotiated()
    const callGen = this.generationCounter
    try {
      const res = await this.connection.invoke<T>(endpoint, payload)
      if (this.generationCounter !== callGen) {
        const isWrite = typeof payload === 'object' && payload !== null && 'clientRequestId' in payload
        if (isWrite) {
          throw new UnknownOutcomeError(
            `Connection generation changed during write request '${endpoint}'; outcome is unknown`,
          )
        }
        throw new WorkbenchError(
          `Response for '${endpoint}' rejected because connection generation changed while request was in-flight`,
          'CANCELLED',
        )
      }
      return res
    } catch (err) {
      if (err instanceof WorkbenchError) throw err
      if (this.generationCounter !== callGen) {
        const isWrite = typeof payload === 'object' && payload !== null && 'clientRequestId' in payload
        if (isWrite) {
          throw new UnknownOutcomeError(
            `Connection generation changed during write request '${endpoint}' failure; outcome is unknown`,
          )
        }
      }
      throw mapWireError(err)
    }
  }

  /** 写命令幂等：调用方已带 clientRequestId 时保留，否则生成（契约：所有写命令带 clientRequestId） */
  private withClientRequestId<T extends object>(payload: T): T & { clientRequestId: string } {
    const existing = (payload as { clientRequestId?: string }).clientRequestId
    return { ...(payload as object), clientRequestId: existing || randomUUID() } as T & { clientRequestId: string }
  }

  private invalidateOnGeneration(generation: number): void {
    if (this.lastGeneration !== null && generation === this.lastGeneration) return
    this.lastGeneration = generation
    this.generationCounter++
    // 契约：失效旧异步响应；重建 follow 订阅由消费方在重新协商后进行
    for (const dispose of this.activeFollows) {
      try {
        dispose()
      } catch {}
    }
    this.activeFollows.clear()
    this.identity = null
    this.identityVerified = false
    this.negotiatedInCompatMode = false
  }

  async createWorkIntent(rawInput: string, projectId?: string): Promise<WorkIntent> {
    return this.invokeDomain<WorkIntent>(
      'workbench.intents.create',
      this.withClientRequestId({ rawInput, projectId }),
    )
  }

  async getControlSnapshot(): Promise<ControlSnapshot> {
    return this.invokeDomain<ControlSnapshot>('workbench.control.snapshot', {})
  }

  async stopRun(runId: string): Promise<StopResult> {
    return this.invokeDomain<StopResult>('workbench.control.stopRun', this.withClientRequestId({ runId }))
  }

  async stopIntent(intentId: string): Promise<StopResult> {
    return this.invokeDomain<StopResult>('workbench.control.stopIntent', this.withClientRequestId({ intentId }))
  }

  async stopAll(): Promise<StopResult> {
    return this.invokeDomain<StopResult>('workbench.control.stopAll', this.withClientRequestId({}))
  }

  async listUncertain(): Promise<{ runs: Run[]; queue: any[] }> {
    return this.invokeDomain<{ runs: Run[]; queue: any[] }>('workbench.control.uncertain', {})
  }

  async reconcileRun(
    runId: string,
    resolution: {
      state: 'completed' | 'interrupted' | 'failed'
      summary: string
      artifactRefs?: Array<{ title: string; path: string; kind?: string }>
      outcome?: Record<string, unknown>
      suggestedTaskStatus?: Task['statusCode']
    },
  ): Promise<{ run: Run; result?: Result }> {
    return this.invokeDomain<{ run: Run; result?: Result }>(
      'workbench.control.reconcileRun',
      this.withClientRequestId({ runId, ...resolution }),
    )
  }

  async reconcileQueue(queueId: string, action: 'cancel' | 'retry' = 'cancel'): Promise<any> {
    return this.invokeDomain<any>(
      'workbench.control.reconcileQueue',
      this.withClientRequestId({ queueId, action }),
    )
  }

  async saveChatMessage(
    sender: 'user' | 'assistant' | 'system',
    text: string,
    intentId?: string,
  ): Promise<ChatMessage> {
    return this.invokeDomain<ChatMessage>(
      'workbench.chat.save',
      this.withClientRequestId({ sender, text, intentId }),
    )
  }

  async listChatMessages(): Promise<ChatMessage[]> {
    return this.invokeDomain<ChatMessage[]>('workbench.chat.list', {})
  }

  async listProjects(): Promise<Project[]> {
    return this.invokeDomain<Project[]>('workbench.projects.list', {})
  }

  async getProject(id: string): Promise<Project> {
    return this.invokeDomain<Project>('workbench.projects.get', { id })
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    return this.invokeDomain<Project>('workbench.projects.create', this.withClientRequestId(input))
  }

  async updateProject(input: UpdateProjectInput): Promise<Project> {
    return this.invokeDomain<Project>('workbench.projects.update', this.withClientRequestId(input))
  }

  async listTasks(projectId?: string): Promise<Task[]> {
    return this.invokeDomain<Task[]>('workbench.tasks.list', { projectId })
  }

  async getTask(id: string): Promise<Task> {
    return this.invokeDomain<Task>('workbench.tasks.get', { id })
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    return this.invokeDomain<Task>('workbench.tasks.create', this.withClientRequestId(input))
  }

  async updateTask(input: UpdateTaskInput): Promise<Task> {
    return this.invokeDomain<Task>('workbench.tasks.update', this.withClientRequestId(input))
  }

  async startRun(input: StartRunInput): Promise<Run> {
    // StartRunInput.clientRequestId 是必填业务键，原样透传，不覆盖
    return this.invokeDomain<Run>('workbench.runs.start', { ...input })
  }

  async completeRun(input: CompleteRunInput): Promise<{ run: Run; result: Result }> {
    return this.invokeDomain<{ run: Run; result: Result }>(
      'workbench.runs.complete',
      this.withClientRequestId(input),
    )
  }

  async getRun(id: string): Promise<Run> {
    return this.invokeDomain<Run>('workbench.runs.get', { id })
  }

  async listRuns(taskId?: string): Promise<Run[]> {
    return this.invokeDomain<Run[]>('workbench.runs.list', { taskId })
  }

  async getResult(id: string): Promise<Result> {
    return this.invokeDomain<Result>('workbench.results.get', { id })
  }

  async getAssistantState(stableId?: string): Promise<AssistantState> {
    return this.invokeDomain<AssistantState>('workbench.assistant.get', { stableId })
  }

  async rotateAssistantSession(stableId?: string, newSessionId?: string): Promise<AssistantState> {
    return this.invokeDomain<AssistantState>(
      'workbench.assistant.rotate',
      this.withClientRequestId({ stableId, newSessionId }),
    )
  }

  /**
   * 订阅领域事件流。契约要求 baseline + sequence/delta 语义：
   * 本方法按 sequence 去重与单调推进（重复/回退投递不重复回调），generation 变化时自动失效。
   */
  followEvents(afterSequence: number, callback: (event: OutboxEvent) => void): () => void {
    this.checkReady()
    // 协商异步进行；订阅立即建立，身份结论随后生效（离线/版本不兼容会在下一次 invoke 时硬阻塞）
    void this.ensureNegotiated().catch(() => {})

    let maxSequence = afterSequence
    const subGen = this.generationCounter
    const onData = (event: OutboxEvent) => {
      if (this.generationCounter !== subGen) return // generation 变化后丢弃旧流事件
      if (!event || typeof event.sequence !== 'number') return
      if (event.sequence <= maxSequence) return // 重复或回退投递：丢弃，不重复回调
      maxSequence = event.sequence
      callback(event)
    }
    const dispose = this.connection.follow(
      'workbench.events.follow',
      { afterSequence, clientContractVersion: WORKBENCH_REMOTE_CONTRACT_VERSION },
      onData,
    )
    const tracked = () => {
      try {
        dispose()
      } catch {}
      this.activeFollows.delete(tracked)
    }
    this.activeFollows.add(tracked)
    return tracked
  }
}
