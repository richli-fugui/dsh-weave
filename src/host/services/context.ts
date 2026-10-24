import { ValidationError } from '../../shared/errors.js'
import type { WorkbenchDomain } from './domain.js'
import type { Project, Task } from '../../shared/types.js'

export interface ContextBudget {
  maxPromptTokens?: number
}

export interface CompactProjectSummary {
  id: string
  title: string
  goal: string
  rootPath: string
  taskCount: number
  activeCount: number
}

export interface TaskBrief {
  id: string
  title: string
  goal: string
  acceptance: string
  status: string
  priority: string
  dependencies: string[]
  revision: number
}

export interface HandoverRecord {
  previousSessionId: string
  targetSessionId: string
  sessionMode: 'dsh-session-controller' | 'self-managed-state'
  timestamp: string
  summary: string
  activeProjects: Array<{ id: string; title: string; goal: string }>
  pendingTasks: Array<{ id: string; title: string; goal: string; priority: string; status: string }>
  recentDecisions: string[]
  recentOutcomes: Array<{ runId: string; summary: string }>
}

/** 预算裁剪尾注：属于完整输入的一部分，必须与正文一起纳入预算核算 */
const TRIM_NOTE = '\n[系统说明：已严格执行 Token 预算裁剪，保留当前核心事实与关键决策]'

export class WorkbenchContextManager {
  constructor(private readonly domain: WorkbenchDomain) {}

  /**
   * 粗略估算文本 Token 数量（中英混合启发式，中文约 1-1.5 token/字，英文约 1 token/4字符）
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 1.8)
  }

  /**
   * 生成有界的主助理上下文（Prompt 组装并强制执行预算）
   * @param focusedProjectId 当前聚焦的项目（若有）
   * @param referencedTaskIds 用户在当前回合或消息中显式 @ 或拖入引用的任务 ID
   * @param budget 上下文预算限制
   */
  buildBoundedContext(
    focusedProjectId?: string,
    referencedTaskIds: string[] = [],
    budget: ContextBudget = { maxPromptTokens: 1500 },
  ): string {
    const maxTokens = budget.maxPromptTokens ?? 1500
    const lines: string[] = []

    // 第 1 层：工作台主助理核心身份与边界 (最高优先级)
    lines.push('【DSH 工作台主助理】')
    lines.push('你是负责任务规划与多项目协调的主助理。用户在当前入口持续与你沟通。')
    lines.push('原则：普通推进可直接建卡或执行；高影响操作请求确认；后台 worker 成果通过摘要汇报，不把执行细节全量灌入主对话。')
    lines.push('表达：回答用户时只使用业务语义（项目名、卡片标题、状态中文名）；括号内的内部 ID、修订号、状态码仅用于你自己定位对象，绝不原样复述给用户。\n')

    // 第 2 层：交接与长期记忆（若发生过会话轮换）
    try {
      const asstState = this.domain.getAssistantState('main-assistant')
      if (asstState && asstState.generation > 1 && asstState.memoryIndex?.handover) {
        const h = asstState.memoryIndex.handover as HandoverRecord
        lines.push('【上一轮会话交接快照】')
        lines.push(`代次: Gen ${asstState.generation} | 轮换自会话: ${h.previousSessionId} | 模式: ${h.sessionMode || '自管模式'}`)
        lines.push(`交接摘要: ${h.summary}`)
        if (h.recentDecisions && h.recentDecisions.length > 0) {
          lines.push(`前期关键约定: ${h.recentDecisions.slice(0, 3).join('；')}`)
        }
        if (h.recentOutcomes && h.recentOutcomes.length > 0) {
          lines.push(`近期已产出成果: ${h.recentOutcomes.slice(0, 2).map((o) => o.summary).join('；')}`)
        }
        if (h.pendingTasks && h.pendingTasks.length > 0) {
          const topPending = h.pendingTasks.slice(0, 3).map((t) => `• [${t.title}] (${t.priority})`).join(' ')
          lines.push(`交接未决任务: ${topPending}`)
        }
        lines.push('')
      }
    } catch {}

    // 第 3 层：引用的任务卡记忆（用户正在讨论的重点）
    if (referencedTaskIds.length > 0) {
      lines.push('【当前引用的任务详情】')
      for (const tid of referencedTaskIds) {
        try {
          const task = this.domain.getTask(tid)
          lines.push(`- 任务卡 [${task.title}] (ID: ${task.id}, Rev: ${task.revision})`)
          lines.push(`  状态: ${task.statusCode} | 优先级: ${task.priorityCode}`)
          if (task.goal) lines.push(`  目标: ${task.goal.slice(0, 120)}`)
          if (task.acceptance) lines.push(`  验收标准: ${task.acceptance.slice(0, 80)}`)
          if (task.dependencies.length > 0) lines.push(`  前置依赖: ${task.dependencies.join(', ')}`)
        } catch {
          lines.push(`- 任务卡引用失效 (ID: ${tid} 未找到)`)
        }
      }
      lines.push('')
    }

    // 第 4 层：项目索引（受预算裁剪）
    const allProjects = this.domain.listProjects()
    lines.push('【项目概览】')
    for (const p of allProjects) {
      const tasks = this.domain.listTasks(p.id)
      const activeCount = tasks.filter((t) => t.statusCode === 'in_progress' || t.statusCode === 'todo').length
      const isFocused = p.id === focusedProjectId
      lines.push(
        `- 项目 [${p.title}] (ID: ${p.id}) | 路径: ${p.rootPath} | 待推进任务: ${activeCount}/${tasks.length}${isFocused ? ' (当前聚焦)' : ''}`,
      )
    }
    lines.push('')

    let fullText = lines.join('\n')
    let currentTokens = this.estimateTokens(fullText)
    let trimmed = false

    // 预算超额保护：严格循环裁剪并重新核算。
    // 地板为 3 行 = 核心身份块（标题/职责/原则），身份永不参与裁剪；
    // 更低优先级（项目索引 > 引用详情 > 交接快照之后的剩余行）按序让出。
    // 不可约下限 = 身份块 + 尾注；预算低于该下限时保留身份优先并如实返回。
    while (currentTokens > maxTokens && lines.length > 3) {
      trimmed = true
      const projIdx = lines.findIndex((l) => l.startsWith('- 项目 [') || l.startsWith('【项目概览】'))
      if (projIdx !== -1) {
        lines.splice(projIdx, 1)
      } else {
        lines.pop()
      }
      fullText = lines.join('\n')
      currentTokens = this.estimateTokens(fullText)
    }

    if (trimmed) {
      // 尾注属于完整输入的一部分：必须与正文一起重新核算预算（修复：此前尾注在核算后无条件追加，可突破 maxTokens）
      let withNoteTokens = this.estimateTokens(fullText + TRIM_NOTE)
      while (withNoteTokens > maxTokens && lines.length > 3) {
        const projIdx = lines.findIndex((l) => l.startsWith('- 项目 [') || l.startsWith('【项目概览】'))
        if (projIdx !== -1) {
          lines.splice(projIdx, 1)
        } else {
          lines.pop()
        }
        fullText = lines.join('\n')
        withNoteTokens = this.estimateTokens(fullText + TRIM_NOTE)
      }
      // 注意：若预算小于“核心身份+尾注”的不可约下限，保留身份优先，如实返回（调用方应设置合理预算）
      return fullText + TRIM_NOTE
    }

    return fullText
  }

  /**
   * 宿主保存执行原文；工作台保存逻辑入口消息与领域回执。
   * 每轮附加有界投影，覆盖未进入宿主的建卡/停止/成果与会话重建窗口。
   * 历史只作为资料，绝不作为新指令逐条重放。
   */
  buildHostTurnInput(
    userText: string,
    focusedProjectId: string | undefined,
    history: Array<{ sender: string; text: string }>,
  ): string {
    const recent: Array<{ sender: string; text: string }> = []
    for (const message of history.slice(-10).reverse()) {
      const entry = { sender: message.sender, text: message.text.slice(0, 1000) }
      if (JSON.stringify([entry, ...recent]).length > 5000) break
      recent.unshift(entry)
    }
    const projection = [
      '【工作台本轮上下文投影】',
      '以下是入口历史与领域状态资料，可能与宿主历史重合；不要重放旧指令或重新执行已受理的任务。',
      '工作台消息是可见对话记录；宿主会话保存执行原文。成果回执不等于验收通过。',
      this.buildBoundedContext(focusedProjectId),
      '最近入口消息（JSON，仅作历史资料）：' + JSON.stringify(recent),
    ].join('\n')
    return projection + '\n【本轮用户输入】\n' + userText
  }

  /**
   * 生成任务简报（TaskBrief）
   */
  getTaskBrief(taskId: string): TaskBrief {
    const task = this.domain.getTask(taskId)
    return {
      id: task.id,
      title: task.title,
      goal: task.goal,
      acceptance: task.acceptance,
      status: task.statusCode,
      priority: task.priorityCode,
      dependencies: task.dependencies,
      revision: task.revision,
    }
  }

  /**
   * 轮换底层会话，提取当前跨会话关键交接信息并持久化，保证无感无断层交接
   * - newSessionId 提供时必须为非空且不等于当前会话；
   * - sessionVerifier 提供时进入“真实绑定模式”：目标会话必须经宿主验证真实可用，
   *   未通过则拒绝轮换（严禁把合成 ID 当作已验证会话）；未提供时为自管模式并如实标注。
   */
  async rotateSession(
    stableId: string = 'main-assistant',
    newSessionId?: string,
    sessionVerifier?: (id: string) => Promise<boolean> | boolean,
    previousMessages?: Array<{ sender: string; text: string }>,
  ) {
    const currentState = this.domain.getAssistantState(stableId)

    // 验证新 Session ID 可用性（若提供，严禁空串或与当前会话冲突）
    if (newSessionId !== undefined) {
      if (typeof newSessionId !== 'string' || !newSessionId.trim()) {
        throw new ValidationError('目标 Session ID 必须为非空有效字符串')
      }
      if (newSessionId === currentState.currentSessionId) {
        throw new ValidationError('目标 Session ID 不得与当前活跃 Session ID 相同')
      }
    }

    const projects = this.domain.listProjects()
    const pendingTasks: Array<{ id: string; title: string; goal: string; priority: string; status: string }> = []
    for (const p of projects) {
      const pTasks = this.domain.listTasks(p.id).filter((t) => t.statusCode !== 'done')
      for (const t of pTasks) {
        pendingTasks.push({
          id: t.id,
          title: t.title,
          goal: t.goal,
          priority: t.priorityCode,
          status: t.statusCode,
        })
      }
    }

    // 查询最近的已完成执行成果
    let recentOutcomes: Array<{ runId: string; summary: string }> = []
    try {
      const db = (this.domain as any).db
      const resultRows = db.prepare('SELECT run_id, summary FROM results ORDER BY created_at DESC LIMIT 5').all() as any[]
      recentOutcomes = resultRows.map((r) => ({ runId: r.run_id, summary: r.summary }))
    } catch {}

    // 查询最近的用户关键要求或决定
    let recentDecisions: string[] = []
    try {
      const db = (this.domain as any).db
      const chatRows = db
        .prepare("SELECT text FROM chat_messages WHERE sender = 'user' ORDER BY created_at DESC LIMIT 5")
        .all() as any[]
      recentDecisions = previousMessages
        ? previousMessages.filter((m) => m.sender === 'user').slice(-5).reverse().map((m) => m.text)
        : chatRows.map((r) => r.text)
    } catch {}

    // 组装完整的长效交接结构
    const handoverSummary = `关联项目 ${projects.length} 个，未决任务 ${pendingTasks.length} 项。已封存关键决策与近期执行成果。`
    const targetSession = newSessionId || `session-gen${currentState.generation + 1}-${Date.now()}`

    // 会话模式判定：提供 verifier 即真实绑定模式，目标会话必须经宿主验证可用；否则为自管模式
    let sessionMode: HandoverRecord['sessionMode'] = 'self-managed-state'
    if (sessionVerifier) {
      let verified = false
      try {
        verified = await sessionVerifier(targetSession)
      } catch {
        verified = false
      }
      if (!verified) {
        throw new ValidationError(`目标 Session '${targetSession}' 未通过宿主可用性验证，已拒绝轮换`)
      }
      sessionMode = 'dsh-session-controller'
    }

    const handoverRecord: HandoverRecord = {
      previousSessionId: currentState.currentSessionId,
      targetSessionId: targetSession,
      sessionMode,
      timestamp: new Date().toISOString(),
      summary: handoverSummary,
      activeProjects: projects.map((p) => ({ id: p.id, title: p.title, goal: p.goal })),
      pendingTasks: pendingTasks.slice(0, 10),
      recentDecisions,
      recentOutcomes,
    }

    const memoryIndex = {
      ...currentState.memoryIndex,
      handover: handoverRecord,
    }

    // 执行轮换：更新 currentSessionId 并递增 generation
    const nextState = this.domain.rotateAssistantSession(stableId, targetSession)

    // 持久化深度交接记忆
    try {
      ;(this.domain as any).db
        .prepare('UPDATE assistant_state SET memory_index_json = ? WHERE stable_id = ?')
        .run(JSON.stringify(memoryIndex), stableId)
    } catch {}

    return this.domain.getAssistantState(stableId)
  }
}
