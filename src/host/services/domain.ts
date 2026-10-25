import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  CircularDependencyError,
  ConflictError,
  NotFoundError,
  ValidationError,
  WorkbenchError,
} from '../../shared/errors.js'
import type {
  ChatMessage,
  CompleteRunInput,
  CreateProjectInput,
  CreateTaskInput,
  OutboxEvent,
  Project,
  Result,
  Run,
  StartRunInput,
  Task,
  UpdateProjectInput,
  UpdateTaskInput,
  WorkIntent,
} from '../../shared/types.js'

/** 数据库 JSON 字段安全解析：损坏行降级为默认值而非抛错（读取路径永不因脏数据 500） */
function safeParseJsonArray(raw: unknown): unknown[] {
  if (typeof raw !== 'string' || raw.trim() === '') return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

/** 对象版本：损坏或非对象时返回空对象 */
function safeParseJsonObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || raw.trim() === '') return {}
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}
import { runTransaction } from '../db/database.js'

export class WorkbenchDomain {
  constructor(private readonly db: DatabaseSync) {}

  // ================= Projects =================

  createProject(input: CreateProjectInput): Project {
    return runTransaction(this.db, () => {
      const id = input.id ?? randomUUID()
      const now = new Date().toISOString()
      const stmt = this.db.prepare(`
        INSERT INTO projects (id, title, root_path, goal, status, revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'active', 1, ?, ?)
      `)
      stmt.run(id, input.title.trim(), input.rootPath.trim(), (input.goal ?? '').trim(), now, now)

      this.appendOutboxEvent(id, 'project.created', { id, title: input.title })
      return this.getProject(id)
    })
  }

  getProject(id: string): Project {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any
    if (!row) throw new NotFoundError('Project', id)
    return {
      id: row.id,
      title: row.title,
      rootPath: row.root_path,
      goal: row.goal,
      status: row.status,
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  listProjects(): Project[] {
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as any[]
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      rootPath: row.root_path,
      goal: row.goal,
      status: row.status,
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }

  updateProject(input: UpdateProjectInput): Project {
    return runTransaction(this.db, () => {
      const current = this.getProject(input.id)
      if (current.revision !== input.expectedRevision) {
        throw new ConflictError('Project', input.id, input.expectedRevision, current.revision)
      }

      const now = new Date().toISOString()
      const title = input.title !== undefined ? input.title.trim() : current.title
      const rootPath = input.rootPath !== undefined ? input.rootPath.trim() : current.rootPath
      const goal = input.goal !== undefined ? input.goal.trim() : current.goal
      const status = input.status !== undefined ? input.status : current.status
      const nextRev = current.revision + 1

      const updateRes = this.db
        .prepare(`
          UPDATE projects
          SET title = ?, root_path = ?, goal = ?, status = ?, revision = ?, updated_at = ?
          WHERE id = ? AND revision = ?
        `)
        .run(title, rootPath, goal, status, nextRev, now, input.id, current.revision)
      if (updateRes.changes !== 1) {
        const fresh = this.getProject(input.id)
        throw new ConflictError('Project', input.id, current.revision, fresh.revision)
      }

      this.appendOutboxEvent(input.id, 'project.updated', { id: input.id, revision: nextRev })
      return this.getProject(input.id)
    })
  }

  // ================= Tasks =================

  createTask(input: CreateTaskInput): Task {
    const id = input.id ?? randomUUID()
    // 校验 Project 必须存在
    this.getProject(input.projectId)

    const dependencies = input.dependencies ?? []
    this.validateDependencies(id, dependencies)

    // 实体与 Outbox 事件同事务落库：事件写入失败时实体一并回滚，避免“有卡无事件”的投影失步
    return runTransaction(this.db, () => {
      const now = new Date().toISOString()
      const stmt = this.db.prepare(`
        INSERT INTO tasks (
          id, project_id, title, goal, acceptance, status_code, priority_code,
          dependencies_json, progress_percent, revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)
      `)

      stmt.run(
        id,
        input.projectId,
        input.title.trim(),
        (input.goal ?? '').trim(),
        (input.acceptance ?? '').trim(),
        input.statusCode ?? 'todo',
        input.priorityCode ?? 'normal',
        JSON.stringify(dependencies),
        now,
        now,
      )

      this.appendOutboxEvent(id, 'task.created', { id, projectId: input.projectId, title: input.title })
      return this.getTask(id)
    })
  }

  getTask(id: string): Task {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as any
    if (!row) throw new NotFoundError('Task', id)
    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      goal: row.goal,
      acceptance: row.acceptance,
      statusCode: row.status_code,
      priorityCode: row.priority_code,
      dependencies: safeParseJsonArray(row.dependencies_json) as string[],
      progressPercent: row.progress_percent,
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  listTasks(projectId?: string): Task[] {
    const sql = projectId
      ? 'SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at ASC'
      : 'SELECT * FROM tasks ORDER BY created_at ASC'
    const rows = (projectId ? this.db.prepare(sql).all(projectId) : this.db.prepare(sql).all()) as any[]

    return rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      goal: row.goal,
      acceptance: row.acceptance,
      statusCode: row.status_code,
      priorityCode: row.priority_code,
      dependencies: safeParseJsonArray(row.dependencies_json) as string[],
      progressPercent: row.progress_percent,
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }

  updateTask(input: UpdateTaskInput): Task {
    return runTransaction(this.db, () => {
      const current = this.getTask(input.id)
      if (current.revision !== input.expectedRevision) {
        throw new ConflictError('Task', input.id, input.expectedRevision, current.revision)
      }

      const dependencies = input.dependencies !== undefined ? input.dependencies : this.readDependenciesForExecution(input.id)
      if (input.dependencies !== undefined) {
        this.validateDependencies(input.id, dependencies)
      }

      if (input.statusCode === 'todo' && current.statusCode === 'blocked') {
        const hasUnresolved = Boolean(
          this.db.prepare("SELECT id FROM runs WHERE task_id = ? AND state = 'unknown' LIMIT 1").get(input.id) ||
          this.db.prepare("SELECT id FROM task_queue WHERE task_id = ? AND status = 'unknown' LIMIT 1").get(input.id)
        )
        if (hasUnresolved) {
          throw new WorkbenchError(
            `Task '${input.id}' cannot be manually set to todo while it has an unresolved unknown execution; reconcile the execution first`,
            'UNKNOWN_OUTCOME',
          )
        }
      }

      const now = new Date().toISOString()
      const title = input.title !== undefined ? input.title.trim() : current.title
      const goal = input.goal !== undefined ? input.goal.trim() : current.goal
      const acceptance = input.acceptance !== undefined ? input.acceptance.trim() : current.acceptance
      const statusCode = input.statusCode !== undefined ? input.statusCode : current.statusCode
      const priorityCode = input.priorityCode !== undefined ? input.priorityCode : current.priorityCode
      const progressPercent =
        input.progressPercent !== undefined ? input.progressPercent : current.progressPercent
      const nextRev = current.revision + 1

      const updateRes = this.db
        .prepare(`
          UPDATE tasks
          SET title = ?, goal = ?, acceptance = ?, status_code = ?, priority_code = ?,
              dependencies_json = ?, progress_percent = ?, revision = ?, updated_at = ?
          WHERE id = ? AND revision = ?
        `)
        .run(
          title,
          goal,
          acceptance,
          statusCode,
          priorityCode,
          JSON.stringify(dependencies),
          progressPercent,
          nextRev,
          now,
          input.id,
          current.revision,
        )
      // SQL 层乐观锁兜底：即使校验与写入之间出现跨进程写入（WAL 多进程可见），
      // 也以 changes=0 拒绝而非静默覆盖（TS 层同值校验拦不住跨进程竞态）
      if (updateRes.changes !== 1) {
        const fresh = this.getTask(input.id)
        throw new ConflictError('Task', input.id, current.revision, fresh.revision)
      }

      this.appendOutboxEvent(input.id, 'task.updated', { id: input.id, revision: nextRev, statusCode })
      return this.getTask(input.id)
    })
  }

  // ================= Runs & Execution =================

  /** Request identity covers execution, not just the number of Run rows. */
  getRunForRequest(input: StartRunInput): Run | undefined {
    const row = this.db.prepare('SELECT * FROM runs WHERE client_request_id = ?').get(input.clientRequestId) as any
    if (!row) return undefined
    if (row.task_id !== input.taskId || (row.intent_id ?? undefined) !== input.intentId ||
        (input.workerSessionId && row.worker_session_id !== input.workerSessionId)) {
      throw new WorkbenchError('clientRequestId is already bound to a different run request', 'CONFLICT')
    }
    return this.mapRunRow(row)
  }

  startRun(input: StartRunInput): Run {
    return this.admitRun(input).run
  }

  /** Persist admission and queue consumption together; only created=true may execute. */
  admitRun(input: StartRunInput, queueItemId?: string): { run: Run; created: boolean } {
    if (!input.clientRequestId?.trim()) throw new ValidationError('clientRequestId is required')
    return runTransaction(this.db, () => {
      const existing = this.getRunForRequest(input)
      if (existing) return { run: existing, created: false }
      const reservedQueue = this.getQueueForRequest(input)
      if (reservedQueue && !queueItemId) {
        throw new WorkbenchError('This request belongs to the durable queue', reservedQueue.status === 'cancelled' ? 'CANCELLED' : reservedQueue.status === 'unknown' ? 'UNKNOWN_OUTCOME' : 'CONFLICT')
      }
      if (queueItemId) {
        const q = this.db.prepare('SELECT * FROM task_queue WHERE id = ?').get(queueItemId) as any
        if (!q || q.status !== 'queued' || q.task_id !== input.taskId ||
            q.client_request_id !== input.clientRequestId || (q.intent_id ?? undefined) !== input.intentId) {
          throw new WorkbenchError('Queue claim no longer matches this request', 'CONFLICT')
        }
      }
      const unresolved = this.db.prepare(
        "SELECT id FROM runs WHERE task_id = ? AND state IN ('running','stopping','awaiting_input','unknown') LIMIT 1",
      ).get(input.taskId)
      if (unresolved) throw new WorkbenchError('Task has an unresolved execution; reconcile it before starting another', 'UNKNOWN_OUTCOME')
      const uncertainQueue = this.db.prepare(
        "SELECT id FROM task_queue WHERE task_id = ? AND status = 'unknown' LIMIT 1",
      ).get(input.taskId)
      if (uncertainQueue) throw new WorkbenchError('Task has an unresolved queue claim', 'UNKNOWN_OUTCOME')
      const task = this.getTask(input.taskId)
      if (task.statusCode !== 'todo') throw new ValidationError('Only a ready todo task can start a new execution')
      for (const depId of this.readDependenciesForExecution(task.id)) {
        const dep = this.getTask(depId)
        if (dep.statusCode !== 'done') throw new ValidationError(
          "Prerequisite task '" + dep.title + "' (" + depId + ") is not done (current: " + dep.statusCode + ")",
        )
      }
      let controlEpoch = 1
      if (input.intentId) {
        const intent = this.getWorkIntent(input.intentId)
        controlEpoch = intent.controlEpoch
        if (intent.status === 'stopping' || intent.status === 'stopped') {
          throw new ValidationError("WorkIntent '" + input.intentId + "' is in '" + intent.status + "' state; new runs are blocked")
        }
      }
      const id = randomUUID()
      const now = new Date().toISOString()
      this.db.prepare(
        "INSERT INTO runs (id, task_id, client_request_id, intent_id, control_epoch, state, worker_session_id, started_at) VALUES (?, ?, ?, ?, ?, 'running', ?, ?)",
      ).run(id, input.taskId, input.clientRequestId, input.intentId ?? null, controlEpoch, input.workerSessionId ?? null, now)
      if (queueItemId) this.db.prepare("UPDATE task_queue SET status = 'started' WHERE id = ?").run(queueItemId)
      this.db.prepare('UPDATE tasks SET status_code = ?, revision = revision + 1, updated_at = ? WHERE id = ?')
        .run('in_progress', now, input.taskId)
      this.appendOutboxEvent(id, 'run.started', { runId: id, taskId: input.taskId, intentId: input.intentId, state: 'running' })
      return { run: this.getRun(id), created: true }
    })
  }

  getRun(id: string): Run {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as any
    if (!row) throw new NotFoundError('Run', id)
    return this.mapRunRow(row)
  }

  attachWorkerSession(runId: string, workerSessionId: string): void {
    this.db.prepare('UPDATE runs SET worker_session_id = ? WHERE id = ?').run(workerSessionId, runId)
  }

  listRuns(taskId?: string): Run[] {
    const sql = taskId
      ? 'SELECT * FROM runs WHERE task_id = ? ORDER BY started_at DESC'
      : 'SELECT * FROM runs ORDER BY started_at DESC'
    const rows = (taskId ? this.db.prepare(sql).all(taskId) : this.db.prepare(sql).all()) as any[]
    return rows.map((r) => this.mapRunRow(r))
  }

  listRunningRuns(): Run[] {
    const rows = this.db.prepare("SELECT * FROM runs WHERE state IN ('running', 'stopping') ORDER BY started_at ASC").all() as any[]
    return rows.map((r) => this.mapRunRow(r))
  }

  reconcileCrashedRunsOnStartup(): { reconciledRunsCount: number; reconciledQueueCount: number } {
    return runTransaction(this.db, () => {
      const now = new Date().toISOString()
      const rows = this.db.prepare("SELECT * FROM runs WHERE state IN ('running','stopping','awaiting_input')").all() as any[]
      for (const row of rows) {
        const outcome = { ...safeParseJsonObject(row.outcome_json), recoveryRequired: true,
          previousState: row.state, reason: 'Execution outcome must be reconciled with its worker after restart' }
        this.db.prepare("UPDATE runs SET state = 'unknown', finished_at = NULL, outcome_json = ? WHERE id = ?")
          .run(JSON.stringify(outcome), row.id)
        this.db.prepare("UPDATE tasks SET status_code = 'blocked', revision = revision + 1, updated_at = ? WHERE id = ? AND status_code = 'in_progress'")
          .run(now, row.task_id)
        this.appendOutboxEvent(row.id, 'run.recovery_required', { runId: row.id, taskId: row.task_id, previousState: row.state })
      }
      // Older versions consumed the queue before persisting its Run; do not invent its outcome.
      const orphans = this.db.prepare(
        "SELECT q.* FROM task_queue q WHERE q.status = 'started' AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.client_request_id = q.client_request_id)",
      ).all() as any[]
      for (const q of orphans) {
        this.db.prepare("UPDATE task_queue SET status = 'unknown' WHERE id = ?").run(q.id)
        this.db.prepare("UPDATE tasks SET status_code = 'blocked', revision = revision + 1, updated_at = ? WHERE id = ? AND status_code = 'todo'")
          .run(now, q.task_id)
        this.appendOutboxEvent(q.id, 'queue.recovery_required', { queueId: q.id, taskId: q.task_id })
      }
      return { reconciledRunsCount: rows.length, reconciledQueueCount: orphans.length }
    })
  }

  hasUncertainProject(projectId: string): boolean {
    return Boolean(this.db.prepare("SELECT r.id FROM runs r JOIN tasks t ON t.id = r.task_id WHERE t.project_id = ? AND r.state = 'unknown' LIMIT 1").get(projectId)) ||
      Boolean(this.db.prepare("SELECT id FROM task_queue WHERE project_id = ? AND status = 'unknown' LIMIT 1").get(projectId))
  }

  listUncertainQueue() {
    return this.listQueueByStatus('unknown')
  }

  listUncertainRuns(): Run[] {
    const rows = this.db.prepare("SELECT * FROM runs WHERE state = 'unknown' ORDER BY started_at ASC").all() as any[]
    return rows.map((r) => this.mapRunRow(r))
  }

  /**
   * 对账并解除未知状态的执行（T-012）
   * 必须基于真实的 Worker 查询或操作员显式判定，原子推进任务状态与清理保护
   */
  reconcileUnknownRun(
    runId: string,
    resolution: {
      state: 'completed' | 'interrupted' | 'failed'
      summary: string
      artifactRefs?: Array<{ title: string; path: string; kind?: string }>
      outcome?: Record<string, unknown>
      suggestedTaskStatus?: Task['statusCode']
    },
  ): { run: Run; result?: Result } {
    return runTransaction(this.db, () => {
      const run = this.getRun(runId)
      if (run.state !== 'unknown') {
        throw new ValidationError(`Run '${runId}' is not in unknown state (current: ${run.state})`)
      }

      const now = new Date().toISOString()
      const outcome = {
        ...run.outcome,
        ...resolution.outcome,
        reconciledAt: now,
        reconciliationSummary: resolution.summary,
      }

      if (resolution.state === 'completed') {
        const resultId = randomUUID()
        const artifactRefs = resolution.artifactRefs ?? []
        this.db
          .prepare(
            `UPDATE runs SET state = 'completed', finished_at = ?, outcome_json = ? WHERE id = ?`,
          )
          .run(now, JSON.stringify(outcome), runId)

        this.db
          .prepare(
            `INSERT INTO results (
              id, run_id, summary, artifact_refs_json, evidence_refs_json,
              next_actions_json, review_state, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
          )
          .run(resultId, runId, resolution.summary, JSON.stringify(artifactRefs), JSON.stringify([]), JSON.stringify([]), now)

        const nextStatus = resolution.suggestedTaskStatus || 'review'
        this.db
          .prepare(`UPDATE tasks SET status_code = ?, revision = revision + 1, updated_at = ? WHERE id = ?`)
          .run(nextStatus, now, run.taskId)

        const taskQueueRow = this.db.prepare('SELECT id FROM task_queue WHERE client_request_id = ?').get(run.clientRequestId) as any
        if (taskQueueRow) {
          this.db.prepare("UPDATE task_queue SET status = 'started' WHERE id = ?").run(taskQueueRow.id)
        }

        const reconciledRun = this.getRun(runId)
        const result = this.getResult(resultId)
        this.appendOutboxEvent(runId, 'run.reconciled', { runId, taskId: run.taskId, state: 'completed' })
        return { run: reconciledRun, result }
      } else {
        // interrupted or failed
        this.db
          .prepare(
            `UPDATE runs SET state = ?, finished_at = ?, outcome_json = ? WHERE id = ?`,
          )
          .run(resolution.state, now, JSON.stringify(outcome), runId)

        const nextStatus = resolution.suggestedTaskStatus || 'todo'
        this.db
          .prepare(`UPDATE tasks SET status_code = ?, revision = revision + 1, updated_at = ? WHERE id = ?`)
          .run(nextStatus, now, run.taskId)

        const taskQueueRow = this.db.prepare('SELECT id FROM task_queue WHERE client_request_id = ?').get(run.clientRequestId) as any
        if (taskQueueRow) {
          this.db.prepare("UPDATE task_queue SET status = 'cancelled' WHERE id = ?").run(taskQueueRow.id)
        }

        const reconciledRun = this.getRun(runId)
        this.appendOutboxEvent(runId, 'run.reconciled', { runId, taskId: run.taskId, state: resolution.state })
        return { run: reconciledRun }
      }
    })
  }

  /**
   * 对账孤立/未知状态的队列项
   */
  reconcileUnknownQueue(queueId: string, action: 'cancel' | 'retry' = 'cancel') {
    return runTransaction(this.db, () => {
      const q = this.getQueueItem(queueId)
      if (q.status !== 'unknown') {
        throw new ValidationError(`Queue item '${queueId}' is not in unknown state (current: ${q.status})`)
      }
      const now = new Date().toISOString()
      const nextQueueStatus = action === 'retry' ? 'queued' : 'cancelled'
      this.db.prepare('UPDATE task_queue SET status = ? WHERE id = ?').run(nextQueueStatus, queueId)
      this.db.prepare("UPDATE tasks SET status_code = 'todo', revision = revision + 1, updated_at = ? WHERE id = ? AND status_code = 'blocked'")
        .run(now, q.taskId)
      this.appendOutboxEvent(queueId, 'queue.reconciled', { queueId, taskId: q.taskId, action })
      return this.getQueueItem(queueId)
    })
  }

  completeRun(input: CompleteRunInput): { run: Run; result: Result } {
    return runTransaction(this.db, () => {
      const run = this.getRun(input.runId)
      if (['completed', 'failed', 'interrupted'].includes(run.state)) {
        throw new ValidationError(`Run '${input.runId}' has already finished with state ${run.state}`)
      }

      const now = new Date().toISOString()
      const outcomeJson = JSON.stringify(input.outcome ?? {})

      this.db
        .prepare(`
          UPDATE runs
          SET state = ?, finished_at = ?, outcome_json = ?
          WHERE id = ?
        `)
        .run(input.state, now, outcomeJson, input.runId)

      const resultId = randomUUID()
      const artifactRefs = input.artifactRefs ?? []
      const evidenceRefs = input.evidenceRefs ?? []
      const nextActions = input.nextActions ?? []

      this.db
        .prepare(`
          INSERT INTO results (
            id, run_id, summary, artifact_refs_json, evidence_refs_json,
            next_actions_json, review_state, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
        `)
        .run(
          resultId,
          input.runId,
          input.summary,
          JSON.stringify(artifactRefs),
          JSON.stringify(evidenceRefs),
          JSON.stringify(nextActions),
          now,
        )

      // 任务状态流转：根据建议状态，默认进入 'review'（Run completed 不等于 Task done）
      const nextTaskStatus = input.suggestedTaskStatus ?? (input.state === 'completed' ? 'review' : 'blocked')
      this.db
        .prepare('UPDATE tasks SET status_code = ?, revision = revision + 1, updated_at = ? WHERE id = ?')
        .run(nextTaskStatus, now, run.taskId)

      // 成果与卡点回流主入口：后台 Run 结束后，用户的日常对话窗口必须自动看到结论，
      // 不依赖用户刷新、追问或自行整理记忆。completeRun 对同一 Run 幂等（终态再次调用会拒绝），
      // 因此该消息严格一次；消息只呈现业务语义（任务、结论、交付物、卡片状态），不暴露内部 ID。
      try {
        const settledTaskTitle = this.getTask(run.taskId).title
        const artifactLines = artifactRefs
          .slice(0, 3)
          .map((a) => `交付物：${a.path ?? a.title}`)
          .filter(Boolean)
        const statusLine =
          nextTaskStatus === 'done'
            ? '卡片状态：已完成归档。'
            : nextTaskStatus === 'review'
              ? '卡片状态：等待你验收。'
              : nextTaskStatus === 'blocked'
                ? '卡片状态：已标记为阻塞。'
                : `卡片状态：${nextTaskStatus}。`
        const headline =
          input.state !== 'completed'
            ? input.state === 'failed'
              ? `⚠️ 未完成：${settledTaskTitle}`
              : `⏹ 已停止：${settledTaskTitle}`
            : nextTaskStatus === 'blocked'
              ? `⚠️ 执行结束但未达验收：${settledTaskTitle}`
              : nextTaskStatus === 'review'
                ? `✅ 已完成（待验收）：${settledTaskTitle}`
                : `✅ 已完成：${settledTaskTitle}`
        const tail =
          input.state === 'interrupted'
            ? '已有成果保留；可继续推进同一张卡。'
            : input.state === 'failed'
              ? '可查看结论后重新推进，或调整任务目标。'
              : nextTaskStatus === 'blocked'
                ? '可直接重提同一诉求，我会把这张卡放回待办并重新推进。'
                : ''
        this.saveChatMessage(
          'assistant',
          [headline, input.summary, ...artifactLines, statusLine, tail].filter(Boolean).join('\n'),
          run.intentId,
        )
      } catch {
        // 回流失败不阻断执行结果入库
      }

      this.appendOutboxEvent(resultId, 'run.completed', {
        runId: input.runId,
        taskId: run.taskId,
        runState: input.state,
        taskStatus: nextTaskStatus,
      })

      const updatedRun = this.getRun(input.runId)
      const createdResult = this.getResult(resultId)
      return { run: updatedRun, result: createdResult }
    })
  }

  getResult(id: string): Result {
    const row = this.db.prepare('SELECT * FROM results WHERE id = ?').get(id) as any
    if (!row) throw new NotFoundError('Result', id)
    return {
      id: row.id,
      runId: row.run_id,
      summary: row.summary,
      artifactRefs: JSON.parse(row.artifact_refs_json || '[]'),
      evidenceRefs: JSON.parse(row.evidence_refs_json || '[]'),
      nextActions: JSON.parse(row.next_actions_json || '[]'),
      reviewState: row.review_state,
      createdAt: row.created_at,
    }
  }

  // ================= Outbox Events =================

  appendOutboxEvent(entityId: string, type: string, payload: Record<string, unknown>): OutboxEvent {
    const now = new Date().toISOString()
    const stmt = this.db.prepare(`
      INSERT INTO outbox_events (entity_id, type, payload_json, delivery_state, created_at)
      VALUES (?, ?, ?, 'pending', ?)
    `)
    const info = stmt.run(entityId, type, JSON.stringify(payload), now)
    const seq = Number(info.lastInsertRowid)

    return {
      sequence: seq,
      entityId,
      type,
      payload,
      deliveryState: 'pending',
      createdAt: now,
    }
  }

  listOutboxEvents(afterSequence: number = 0, limit: number = 100): OutboxEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM outbox_events WHERE sequence > ? ORDER BY sequence ASC LIMIT ?')
      .all(afterSequence, limit) as any[]

    return rows.map((r) => ({
      sequence: r.sequence,
      entityId: r.entity_id,
      type: r.type,
      payload: JSON.parse(r.payload_json || '{}'),
      deliveryState: r.delivery_state,
      createdAt: r.created_at,
    }))
  }

  // ================= Assistant State =================

  /** Pending control and any late delivery commit together; a crash cannot deliver twice. */
  savePendingHostTurn(turn: Record<string, unknown> | null, delivery?: {
    entityId: string; type: string; payload: Record<string, unknown>; text?: string; intentId?: string
  }): void {
    runTransaction(this.db, () => {
      const state = this.getAssistantState()
      if (delivery) {
        if (delivery.text) this.saveChatMessage('assistant', delivery.text, delivery.intentId)
        this.appendOutboxEvent(delivery.entityId, delivery.type, delivery.payload)
      }
      this.db.prepare('UPDATE assistant_state SET memory_index_json = ?, updated_at = ? WHERE stable_id = ?')
        .run(JSON.stringify({ ...state.memoryIndex, pendingHostTurn: turn }), new Date().toISOString(), state.stableId)
    })
  }

  getAssistantState(stableId: string = 'main-assistant') {
    let row = this.db.prepare('SELECT * FROM assistant_state WHERE stable_id = ?').get(stableId) as any
    if (!row) {
      const now = new Date().toISOString()
      const initialSessionId = `session-${randomUUID()}`
      this.db
        .prepare(`
          INSERT INTO assistant_state (stable_id, current_session_id, generation, memory_index_json, updated_at)
          VALUES (?, ?, 1, '{}', ?)
        `)
        .run(stableId, initialSessionId, now)
      row = this.db.prepare('SELECT * FROM assistant_state WHERE stable_id = ?').get(stableId) as any
    }
    return {
      stableId: row.stable_id,
      currentSessionId: row.current_session_id,
      generation: row.generation,
      memoryIndex: JSON.parse(row.memory_index_json || '{}'),
      updatedAt: row.updated_at,
    }
  }

  rotateAssistantSession(stableId: string = 'main-assistant', newSessionId?: string) {
    return runTransaction(this.db, () => {
      const current = this.getAssistantState(stableId)
      const nextSessionId = newSessionId ?? `session-${randomUUID()}`
      const nextGen = current.generation + 1
      const now = new Date().toISOString()

      this.db
        .prepare(`
          UPDATE assistant_state
          SET current_session_id = ?, generation = ?, updated_at = ?
          WHERE stable_id = ?
        `)
        .run(nextSessionId, nextGen, now, stableId)

      this.appendOutboxEvent(stableId, 'assistant.rotated', {
        stableId,
        generation: nextGen,
        currentSessionId: nextSessionId,
      })
      return this.getAssistantState(stableId)
    })
  }

  // ================= Work Intents & Control =================

  createWorkIntent(rawInput: string, projectId?: string): WorkIntent {
    const id = randomUUID()
    const now = new Date().toISOString()
    this.db
      .prepare(`
        INSERT INTO work_intents (id, project_id, raw_input, status, control_epoch, created_at, updated_at)
        VALUES (?, ?, ?, 'accepted', 1, ?, ?)
      `)
      .run(id, projectId ?? null, rawInput.trim(), now, now)

    this.appendOutboxEvent(id, 'intent.created', { id, rawInput, projectId })
    return this.getWorkIntent(id)
  }

  getWorkIntent(id: string): WorkIntent {
    const row = this.db.prepare('SELECT * FROM work_intents WHERE id = ?').get(id) as any
    if (!row) throw new NotFoundError('WorkIntent', id)
    return {
      id: row.id,
      projectId: row.project_id || undefined,
      rawInput: row.raw_input,
      status: row.status,
      controlEpoch: row.control_epoch,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  updateWorkIntentStatus(id: string, status: WorkIntent['status']): WorkIntent {
    return runTransaction(this.db, () => {
      const intent = this.getWorkIntent(id)
      const now = new Date().toISOString()
      this.db
        .prepare('UPDATE work_intents SET status = ?, updated_at = ? WHERE id = ?')
        .run(status, now, id)
      this.appendOutboxEvent(id, 'intent.status_changed', { id, status })
      return this.getWorkIntent(id)
    })
  }

  incrementWorkIntentEpoch(id: string): number {
    return runTransaction(this.db, () => {
      const intent = this.getWorkIntent(id)
      const nextEpoch = intent.controlEpoch + 1
      const now = new Date().toISOString()
      this.db
        .prepare('UPDATE work_intents SET control_epoch = ?, updated_at = ? WHERE id = ?')
        .run(nextEpoch, now, id)
      return nextEpoch
    })
  }

  updateRunState(runId: string, state: Run['state'], outcome?: Record<string, unknown>): Run {
    return runTransaction(this.db, () => {
      const run = this.getRun(runId)
      const now = new Date().toISOString()
      const outcomeJson = outcome ? JSON.stringify(outcome) : JSON.stringify(run.outcome ?? {})
      const finishedAt = ['completed', 'failed', 'interrupted', 'stopped'].includes(state) ? now : run.finishedAt ?? null

      this.db
        .prepare('UPDATE runs SET state = ?, finished_at = ?, outcome_json = ? WHERE id = ?')
        .run(state, finishedAt, outcomeJson, runId)

      this.appendOutboxEvent(runId, 'run.state_changed', { runId, state })
      return this.getRun(runId)
    })
  }

  // ================= Chat Messages =================

  saveChatMessage(sender: 'user' | 'assistant' | 'system', text: string, intentId?: string): ChatMessage {
    const id = randomUUID()
    const now = new Date().toISOString()
    let validIntentId: string | null = null
    if (intentId) {
      try {
        const intentRow = this.db.prepare('SELECT id FROM work_intents WHERE id = ?').get(intentId)
        if (intentRow) validIntentId = intentId
      } catch {
        validIntentId = null
      }
    }
    this.db
      .prepare(`
        INSERT INTO chat_messages (id, sender, text, intent_id, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(id, sender, text, validIntentId, now)

    return {
      id,
      sender,
      text,
      intentId: validIntentId || undefined,
      createdAt: now,
    }
  }

  /**
   * 列出聊天历史。
   * 语义：返回“最近 limit 条”并按时间正序排列（供主助理连续上下文与前端渲染使用）。
   * 修复说明：此前为 `ORDER BY created_at ASC LIMIT ?`，超过 limit 后返回的是最早一批消息，
   * 导致最新事实被永久挤出上下文（两轮指代/最新决定丢失）。现按 created_at DESC + rowid DESC
   * 稳定取最新后在内存中反转，保证同一毫秒内的批量写入也有确定顺序。
   */
  listChatMessages(limit: number = 50): ChatMessage[] {
    const rows = this.db
      .prepare('SELECT * FROM chat_messages ORDER BY created_at DESC, rowid DESC LIMIT ?')
      .all(limit) as any[]
    rows.reverse()

    return rows.map((r) => ({
      id: r.id,
      sender: r.sender,
      text: r.text,
      intentId: r.intent_id || undefined,
      createdAt: r.created_at,
    }))
  }

  // ================= Private Helpers =================

  private mapRunRow(row: any): Run {
    return {
      id: row.id,
      taskId: row.task_id,
      clientRequestId: row.client_request_id,
      intentId: row.intent_id || undefined,
      state: row.state,
      workerSessionId: row.worker_session_id || undefined,
      controlEpoch: row.control_epoch || 1,
      startedAt: row.started_at,
      finishedAt: row.finished_at || undefined,
      outcome: safeParseJsonObject(row.outcome_json),
    }
  }

  /** UI reads can degrade gracefully; execution must not turn corrupt prerequisites into none. */
  private readDependenciesForExecution(taskId: string): string[] {
    const row = this.db.prepare('SELECT dependencies_json FROM tasks WHERE id = ?').get(taskId) as { dependencies_json: string } | undefined
    if (!row) throw new NotFoundError('Task', taskId)
    try {
      const parsed = JSON.parse(row.dependencies_json)
      if (Array.isArray(parsed) && parsed.every(id => typeof id === 'string' && id.trim().length > 0)) return parsed
    } catch { /* reject admission below */ }
    throw new WorkbenchError('任务依赖数据损坏，请明确修复依赖后再执行；未自动清空依赖。', 'CORRUPT_DEPENDENCIES')
  }

  private validateDependencies(taskId: string, dependencies: string[]) {
    // 依赖不能包含自己
    if (dependencies.includes(taskId)) {
      throw new ValidationError(`Task '${taskId}' cannot depend on itself`)
    }

    // 依赖的任务必须存在
    for (const depId of dependencies) {
      const dep = this.db.prepare('SELECT id FROM tasks WHERE id = ?').get(depId)
      if (!dep) {
        throw new ValidationError(`Prerequisite task '${depId}' does not exist`)
      }
    }

    // 拓扑环形检测：构建依赖图，从 taskId 出发不能回到 taskId
    const visited = new Set<string>()
    const inStack = new Set<string>()

    const hasCycle = (curr: string, path: string[]): boolean => {
      visited.add(curr)
      inStack.add(curr)
      path.push(curr)

      let deps: string[] = []
      if (curr === taskId) {
        deps = dependencies
      } else {
        const row = this.db.prepare('SELECT dependencies_json FROM tasks WHERE id = ?').get(curr) as any
        deps = row ? this.readDependenciesForExecution(curr) : []
      }

      for (const next of deps) {
        if (!visited.has(next)) {
          if (hasCycle(next, path)) return true
        } else if (inStack.has(next)) {
          path.push(next)
          return true
        }
      }

      path.pop()
      inStack.delete(curr)
      return false
    }

    const path: string[] = []
    if (hasCycle(taskId, path)) {
      throw new CircularDependencyError(path)
    }
  }

  // ================= Task Queue Persistence =================

  enqueueTask(item: {
    id: string
    taskId: string
    clientRequestId: string
    intentId?: string
    taskTitle: string
    projectId: string
    controlEpoch: number
  }): void {
    const now = new Date().toISOString()
    this.db
      .prepare(`
        INSERT INTO task_queue (
          id, task_id, client_request_id, intent_id, task_title,
          project_id, control_epoch, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)
      `)
      .run(
        item.id,
        item.taskId,
        item.clientRequestId,
        item.intentId ?? null,
        item.taskTitle,
        item.projectId,
        item.controlEpoch,
        now,
      )
  }

  cancelQueueItems(ids: string[]): void {
    runTransaction(this.db, () => {
      for (const id of ids) this.db.prepare("UPDATE task_queue SET status = 'cancelled' WHERE id = ? AND status = 'queued'").run(id)
    })
  }

  updateQueueItemStatus(id: string, status: 'started' | 'cancelled'): void {
    this.db.prepare('UPDATE task_queue SET status = ? WHERE id = ?').run(status, id)
  }

  getQueueItem(id: string) {
    const r = this.db.prepare('SELECT * FROM task_queue WHERE id = ?').get(id) as any
    if (!r) throw new NotFoundError('QueueItem', id)
    return {
      id: r.id as string,
      taskId: r.task_id as string,
      clientRequestId: r.client_request_id as string,
      intentId: (r.intent_id || undefined) as string | undefined,
      taskTitle: r.task_title as string,
      projectId: r.project_id as string,
      controlEpoch: r.control_epoch as number,
      status: r.status as string,
      createdAt: r.created_at as string,
    }
  }

  getQueueForRequest(input: StartRunInput) {
    const row = this.db.prepare('SELECT * FROM task_queue WHERE client_request_id = ?').get(input.clientRequestId) as any
    if (!row) return undefined
    if (row.task_id !== input.taskId || (row.intent_id ?? undefined) !== input.intentId) {
      throw new WorkbenchError('clientRequestId is already bound to a different queue request', 'CONFLICT')
    }
    return { id: row.id as string, status: row.status as string, createdAt: row.created_at as string }
  }

  listPendingQueue() {
    return this.listQueueByStatus('queued')
  }

  private listQueueByStatus(status: string): Array<{
    id: string; taskId: string; clientRequestId: string; intentId?: string
    taskTitle: string; projectId: string; controlEpoch: number; status: string; createdAt: string
  }> {
    const rows = this.db.prepare('SELECT * FROM task_queue WHERE status = ? ORDER BY created_at ASC, rowid ASC').all(status) as any[]
    return rows.map((r) => ({
      id: r.id, taskId: r.task_id, clientRequestId: r.client_request_id,
      intentId: r.intent_id || undefined, taskTitle: r.task_title, projectId: r.project_id,
      controlEpoch: r.control_epoch, status: r.status, createdAt: r.created_at,
    }))
  }
}
