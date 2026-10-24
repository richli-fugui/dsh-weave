import type { WorkbenchDomain } from '../host/services/domain.js'
import type { TaskScheduler } from '../host/services/scheduler.js'
import type { WorkbenchContextManager } from '../host/services/context.js'
import { ValidationError } from '../shared/errors.js'
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

export class LocalProvider implements WorkbenchProvider {
  constructor(
    private readonly domain: WorkbenchDomain,
    private readonly scheduler?: TaskScheduler,
    private readonly contextManager?: WorkbenchContextManager,
  ) {}

  async createWorkIntent(rawInput: string, projectId?: string): Promise<WorkIntent> {
    return this.domain.createWorkIntent(rawInput, projectId)
  }

  async getControlSnapshot(): Promise<ControlSnapshot> {
    if (this.scheduler) {
      return this.scheduler.getControlSnapshot()
    }
    return { activeCount: 0, queuedCount: 0, awaitingCount: 0, items: [] }
  }

  async stopRun(runId: string): Promise<StopResult> {
    if (this.scheduler) {
      return this.scheduler.stopRun(runId)
    }
    return { commandId: 'noop', status: 'already_terminal', stoppedRunIds: [] }
  }

  async stopIntent(intentId: string): Promise<StopResult> {
    if (this.scheduler) {
      return this.scheduler.stopIntent(intentId)
    }
    return { commandId: 'noop', status: 'already_terminal', stoppedRunIds: [] }
  }

  async stopAll(): Promise<StopResult> {
    if (this.scheduler) {
      return this.scheduler.stopAll()
    }
    return { commandId: 'noop', status: 'already_terminal', stoppedRunIds: [] }
  }

  async saveChatMessage(sender: 'user' | 'assistant' | 'system', text: string, intentId?: string): Promise<ChatMessage> {
    return this.domain.saveChatMessage(sender, text, intentId)
  }

  async listChatMessages(): Promise<ChatMessage[]> {
    return this.domain.listChatMessages(100)
  }

  async listProjects(): Promise<Project[]> {
    return this.domain.listProjects()
  }

  async getProject(id: string): Promise<Project> {
    return this.domain.getProject(id)
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    return this.domain.createProject(input)
  }

  async updateProject(input: UpdateProjectInput): Promise<Project> {
    return this.domain.updateProject(input)
  }

  async listTasks(projectId?: string): Promise<Task[]> {
    return this.domain.listTasks(projectId)
  }

  async getTask(id: string): Promise<Task> {
    return this.domain.getTask(id)
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    return this.domain.createTask(input)
  }

  async updateTask(input: UpdateTaskInput): Promise<Task> {
    return this.domain.updateTask(input)
  }

  async startRun(input: StartRunInput): Promise<Run> {
    if (this.scheduler) {
      // Pre-fix releases persisted a task-suffixed key even for this single-task API.
      const previous = this.domain.getRunForRequest(input) ?? this.domain.getRunForRequest({ ...input, clientRequestId: input.clientRequestId + '-' + input.taskId })
      if (previous) return previous
      const runs = await this.scheduler.dispatchBatch([input.taskId], input.clientRequestId, input.intentId, true)
      if (runs.length > 0) {
        return runs[0]
      }
      // 检查是否已进入排队队列（返回排队状态，绝不伪造已在运行的虚假记录）
      const queuedItem = this.scheduler.getQueuedItems().find((q) => q.taskId === input.taskId && q.clientRequestId === input.clientRequestId)
      if (queuedItem) {
        return {
          id: queuedItem.id,
          taskId: input.taskId,
          clientRequestId: queuedItem.clientRequestId,
          intentId: queuedItem.intentId,
          state: 'queued',
          startedAt: new Date().toISOString(),
        }
      }
      throw new ValidationError(`任务 [${input.taskId}] 当前无法调度启动（前置依赖尚未就绪或任务已处终态）`)
    }
    return this.domain.startRun(input)
  }

  async completeRun(input: CompleteRunInput): Promise<{ run: Run; result: Result }> {
    return this.domain.completeRun(input)
  }

  async getRun(id: string): Promise<Run> {
    return this.domain.getRun(id)
  }

  async listRuns(taskId?: string): Promise<Run[]> {
    return this.domain.listRuns(taskId)
  }

  async getResult(id: string): Promise<Result> {
    return this.domain.getResult(id)
  }

  async getAssistantState(stableId?: string): Promise<AssistantState> {
    return this.domain.getAssistantState(stableId)
  }

  async rotateAssistantSession(stableId?: string, newSessionId?: string): Promise<AssistantState> {
    if (this.contextManager) {
      return this.contextManager.rotateSession(stableId, newSessionId)
    }
    return this.domain.rotateAssistantSession(stableId, newSessionId)
  }

  async listUncertain(): Promise<{ runs: Run[]; queue: any[] }> {
    return {
      runs: this.domain.listUncertainRuns(),
      queue: this.domain.listUncertainQueue(),
    }
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
    if (this.scheduler) {
      return this.scheduler.reconcileRun(runId, resolution)
    }
    return this.domain.reconcileUnknownRun(runId, resolution)
  }

  async reconcileQueue(queueId: string, action: 'cancel' | 'retry' = 'cancel') {
    if (this.scheduler) {
      return this.scheduler.reconcileQueue(queueId, action)
    }
    return this.domain.reconcileUnknownQueue(queueId, action)
  }

  async autoReconcileWithWorker(): Promise<{
    reconciled: Array<{ runId: string; resolvedState: string }>
    stillUncertain: string[]
  }> {
    if (this.scheduler) {
      return this.scheduler.reconcileUncertainRuns()
    }
    return { reconciled: [], stillUncertain: this.domain.listUncertainRuns().map((r) => r.id) }
  }

  followEvents(afterSequence: number, callback: (event: OutboxEvent) => void): () => void {
    let currentSeq = afterSequence
    let active = true

    const poll = () => {
      if (!active) return
      try {
        const events = this.domain.listOutboxEvents(currentSeq, 50)
        for (const ev of events) {
          if (!active) break
          callback(ev)
          currentSeq = Math.max(currentSeq, ev.sequence)
        }
      } catch (err) {
        console.error('[LocalProvider] Error polling outbox events:', err)
      }
      if (active) {
        timer = setTimeout(poll, 250)
      }
    }

    let timer = setTimeout(poll, 100)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }
}
