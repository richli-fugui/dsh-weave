import React, { useState, useEffect, useRef } from 'react'
import type { Project, Task, OutboxEvent, ControlSnapshot, ChatMessage, StopResult } from './shared/types.js'

export const PANEL_ID = 'workbench'
// 侧栏入口名不能与宿主自带的“工作台”重名，否则用户无法区分本插件与宿主面板
export const ENTRY_TITLE = '任务台'

/** Kept pure so the packaged desktop control copy can be regression tested. */
export const formatStopFeedback = (res: StopResult): string => {
  if (res.status === 'stopped') return '已确认目标工作停止；已有成果保留。'
  if (res.status === 'already_terminal') return '目标工作已结束。'
  if (res.status === 'waiting_tool_exit' || res.status === 'stopping') return '已请求停止，正在等待执行工具退出；尚未确认停止。'
  if (res.status === 'conflict') return '无法确认目标已停止，执行结果仍待核对；请勿重复开工。'
  return '停止请求已收到，等待执行端确认。'
}

/** 卡片状态只呈现业务语义，不把内部状态码暴露给用户。 */
export const taskStatusLabel = (statusCode: string): string => {
  switch (statusCode) {
    case 'todo':
      return '待办'
    case 'in_progress':
      return '推进中'
    case 'review':
      return '待验收'
    case 'done':
      return '已完成'
    case 'blocked':
      return '已阻塞'
    case 'failed':
      return '未完成'
    case 'cancelled':
      return '已取消'
    default:
      return '未知状态'
  }
}

/** 优先级同样只呈现业务语义。 */
export const taskPriorityLabel = (priorityCode: string): string => {
  switch (priorityCode) {
    case 'urgent':
      return '紧急'
    case 'high':
      return '高'
    case 'normal':
      return '普通'
    case 'low':
      return '低'
    default:
      return '普通'
  }
}

/** 运行状态同样只呈现业务语义，不把内部状态码暴露给用户。 */
export const runStateLabel = (state: string): string => {
  switch (state) {
    case 'running':
      return '推进中'
    case 'queued':
      return '排队中'
    case 'stopping':
      return '正在停止'
    case 'awaiting_input':
      return '等待输入'
    case 'completed':
      return '已完成'
    case 'interrupted':
      return '已中断'
    case 'failed':
      return '失败'
    case 'unknown':
      return '结果待核对'
    default:
      return '处理中'
  }
}

// ================= API Client =================
async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}))
    throw new Error(errData.error || `HTTP ${res.status}: ${res.statusText}`)
  }
  return res.json()
}

// ================= 主应用视图 =================
export function WorkbenchView({ onClose }: { onClose?: () => void }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [inputText, setInputText] = useState<string>('')
  const [activeTab, setActiveTab] = useState<'all' | 'todo' | 'in_progress' | 'review' | 'done'>('all')
  const [controlSnapshot, setControlSnapshot] = useState<ControlSnapshot>({
    activeCount: 0,
    queuedCount: 0,
    awaitingCount: 0,
    items: [],
  })
  const [actionFeedback, setActionFeedback] = useState<string | null>(null)
  const [sending, setSending] = useState<boolean>(false)
  const [connection, setConnection] = useState<any>(null)
  const [pendingInteractions, setPendingInteractions] = useState<any[]>([])
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({})
  useEffect(() => {
    let active = true
    const poll = async () => {
      try {
        const identity = await fetchJson('/api/workbench/connection')
        if (active) setConnection(identity)
        const result = await fetchJson<{ pending: any[] }>('/api/workbench/interactions')
        if (active) setPendingInteractions(result.pending)
      } catch { if (active) setPendingInteractions([]) }
    }
    void poll(); const timer = setInterval(poll, 1500)
    return () => { active = false; clearInterval(timer) }
  }, [])

  const respondInteraction = async (item: any, action?: string) => {
    try {
      const answers = item.questions?.map((q: any) => {
        const value = (questionAnswers[item.id + q.id] || '').trim()
        const selected = q.options?.some((o: any) => o.label === value) ? [value] : []
        return { id: q.id, selected, ...(selected.length ? {} : { custom: value }) }
      })
      await fetchJson('/api/workbench/interactions/respond', { method: 'POST', body: JSON.stringify({ id: item.id, sessionId: item.sessionId, turnId: item.turnId, action, answers }) })
      setPendingInteractions(items => items.filter(p => p.id !== item.id))
      setActionFeedback('已答复原请求，后台继续推进。')
    } catch (error: any) { setActionFeedback(error.message) }
  }

  const abandonHost = async () => {
    try {
      const state = await fetchJson<{ host?: any }>('/api/workbench/control/uncertain')
      if (state.host?.status !== 'unknown') { setActionFeedback('请先核验当前状态；未解除保护。'); return }
      if (!window.confirm('仅在你已确认原宿主进程或会话退出时继续。解除保护不会停止仍在运行的工具，也不会撤销已有成果；误确认可能导致重复执行。')) return
      await fetchJson('/api/workbench/control/abandon', { method: 'POST', body: JSON.stringify({ expectedRequestId: state.host.requestId, confirmed: true, reason: '用户明确确认原宿主已退出，放弃该未知轮次' }) })
      setActionFeedback('已放弃旧轮次；没有宣称已验证停止，下次使用新会话。')
      await loadControlSnapshot()
    } catch (error: any) { setActionFeedback(error.message) }
  }

  // 任务编辑与材料补充模态框状态
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [editTitle, setEditTitle] = useState<string>('')
  const [editGoal, setEditGoal] = useState<string>('')
  const [editAcceptance, setEditAcceptance] = useState<string>('')

  // 默认主助理欢迎词
  const defaultWelcomeMessage: ChatMessage = {
    id: 'welcome',
    sender: 'assistant',
    text: '你好！我是工作台主助理。\n• 你可以在这里和我持续对话、梳理并拆解新任务\n• 也可以将左侧任务卡拖入下方输入框，或用 @ 选择任务卡后说“推进这些”\n• 后台 worker 会在独立项目根执行，成果与审批将在这里集中呈现。\n• 顶部设有常驻控制条，独立于对话，可随时一键中止运行中的后台任务。',
    createdAt: new Date().toISOString(),
  }

  const [messages, setMessages] = useState<ChatMessage[]>([defaultWelcomeMessage])

  // 1. 加载项目和任务卡
  const loadData = async () => {
    try {
      const [pList, tList] = await Promise.all([
        fetchJson<Project[]>('/api/workbench/projects').catch(() => []),
        fetchJson<Task[]>('/api/workbench/tasks').catch(() => []),
      ])
      setProjects(pList)
      setTasks(tList)
      if (!selectedProjectId && pList.length > 0) {
        setSelectedProjectId(pList[0].id)
      }
    } catch (err) {
      console.error('[Workbench] Load data error:', err)
    } finally {
      setLoading(false)
    }
  }

  // 2. 加载控制快照 (独立控制路径)
  const loadControlSnapshot = async () => {
    try {
      const snapshot = await fetchJson<ControlSnapshot>('/api/workbench/control/snapshot')
      setControlSnapshot(snapshot)
    } catch (err) {
      // 忽略短暂网络闪断
    }
  }

  // 3. 加载历史聊天记录
  const loadChatMessages = async () => {
    try {
      const chatList = await fetchJson<ChatMessage[]>('/api/workbench/chat/messages').catch(() => [])
      if (chatList && chatList.length > 0) {
        setMessages(chatList)
      }
    } catch (err) {
      // 忽略读取聊天失败
    }
  }

  useEffect(() => {
    loadData()
    loadControlSnapshot()
    loadChatMessages()

    // 轮询 Outbox 事件与控制快照保持实时同步
    let seq = 0
    const interval = setInterval(async () => {
      try {
        const events = await fetchJson<OutboxEvent[]>(`/api/workbench/events?after=${seq}`).catch(() => [])
        if (events && events.length > 0) {
          seq = events[events.length - 1].sequence
          loadData()
          loadChatMessages()
        }
        await loadControlSnapshot()
      } catch {
        // ignore
      }
    }, 1500)
    return () => clearInterval(interval)
  }, [])

  // 触发全局或单项停止
  const handleStop = async (target: { kind: 'all' | 'run' | 'intent'; id?: string }) => {
    try {
      setActionFeedback(`正在向控制路径投递停止指令 (${target.kind}${target.id ? ':' + target.id : ''})...`)
      const res = await fetchJson<StopResult>('/api/workbench/control/stop', {
        method: 'POST',
        body: JSON.stringify({ target }),
      })
      setActionFeedback(formatStopFeedback(res))
      await loadControlSnapshot()
      await loadData()
      await loadChatMessages()
      setTimeout(() => setActionFeedback(null), 4000)
    } catch (err: any) {
      setActionFeedback(`停止失败: ${err.message}`)
      setTimeout(() => setActionFeedback(null), 4000)
    }
  }

  // 单卡快速推进
  const handleStartTaskRun = async (taskId: string) => {
    try {
      setActionFeedback(`正在推进任务 ${taskId.slice(0, 8)}...`)
      await fetchJson('/api/workbench/runs/start', {
        method: 'POST',
        body: JSON.stringify({ taskId, clientRequestId: `cli-${Date.now()}-${taskId}` }),
      })
      setActionFeedback(`任务 ${taskId.slice(0, 8)} 调度成功`)
      await loadControlSnapshot()
      await loadData()
      setTimeout(() => setActionFeedback(null), 3000)
    } catch (err: any) {
      setActionFeedback(`启动推进失败: ${err.message}`)
      setTimeout(() => setActionFeedback(null), 4000)
    }
  }

  // 核对并解除未知状态（T-012）
  const handleReconcileUncertain = async (targetRunId?: string) => {
    try {
      setActionFeedback('正在向控制路径核对未决状态...')
      if (targetRunId) {
        await fetchJson('/api/workbench/control/reconcile', {
          method: 'POST',
          body: JSON.stringify({
            runId: targetRunId,
            resolution: { state: 'interrupted', summary: '用户在界面确认前序执行已退出，解除保护并重置为待办' },
          }),
        })
        setActionFeedback('已核实并解除该任务的未知状态')
      } else {
        const autoRes = await fetchJson<{ reconciled?: any[] }>('/api/workbench/control/reconcile', {
          method: 'POST',
          body: JSON.stringify({ auto: true }),
        })
        if (autoRes.reconciled && autoRes.reconciled.length > 0) {
          setActionFeedback(`已由宿主核实并解除 ${autoRes.reconciled.length} 项未决执行`)
        } else {
          const uncertData = await fetchJson<{ runs?: any[]; queue?: any[] }>('/api/workbench/control/uncertain')
          let resolved = 0
          if (uncertData.runs) {
            for (const r of uncertData.runs) {
              await fetchJson('/api/workbench/control/reconcile', {
                method: 'POST',
                body: JSON.stringify({
                  runId: r.id,
                  resolution: { state: 'interrupted', summary: '经操作员核实：确认前序 Worker 已退出，解除保护并重置为待办' },
                }),
              })
              resolved++
            }
          }
          if (uncertData.queue) {
            for (const q of uncertData.queue) {
              await fetchJson('/api/workbench/control/reconcile', {
                method: 'POST',
                body: JSON.stringify({ queueId: q.id, action: 'cancel' }),
              })
              resolved++
            }
          }
          setActionFeedback(`已核对并解除 ${resolved} 项未知状态，项目保护已恢复正常`)
        }
      }
      await loadControlSnapshot()
      await loadData()
      setTimeout(() => setActionFeedback(null), 4000)
    } catch (err: any) {
      setActionFeedback(`核对失败: ${err.message}`)
      setTimeout(() => setActionFeedback(null), 4000)
    }
  }

  // 保存任务编辑与补充的材料
  const handleSaveTaskEdit = async () => {
    if (!editingTask) return
    try {
      setActionFeedback(`正在更新任务 [${editingTask.title}]...`)
      await fetchJson('/api/workbench/tasks/update', {
        method: 'POST',
        body: JSON.stringify({
          id: editingTask.id,
          expectedRevision: editingTask.revision,
          title: editTitle,
          goal: editGoal,
          acceptance: editAcceptance,
        }),
      })
      setActionFeedback('任务已成功更新')
      setEditingTask(null)
      await loadData()
      setTimeout(() => setActionFeedback(null), 3000)
    } catch (err: any) {
      setActionFeedback(`更新失败: ${err.message}`)
      setTimeout(() => setActionFeedback(null), 4000)
    }
  }

  // 发送主助理消息（通过服务端真实端点）
  const handleSend = async () => {
    if (!inputText.trim() || sending) return
    const text = inputText.trim()
    setInputText('')
    setSending(true)

    // 乐观添加用户消息
    const userMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      sender: 'user',
      text,
      createdAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, userMsg])

    try {
      const res = await fetchJson<{ reply: ChatMessage; intent?: any; runs?: any[]; stopResult?: any }>(
        '/api/workbench/chat/send',
        {
          method: 'POST',
          body: JSON.stringify({ text, projectId: selectedProjectId }),
        },
      )
      if (res && res.reply) {
        setMessages((prev) => [...prev, res.reply])
      }
      await loadControlSnapshot()
      await loadData()
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          sender: 'assistant',
          text: `[错误] 通信异常：${err.message}`,
          createdAt: new Date().toISOString(),
        },
      ])
    } finally {
      setSending(false)
    }
  }

  // 拖卡处理
  const handleDragStart = (e: React.DragEvent, task: Task) => {
    e.dataTransfer.setData('text/plain', `@task:${task.id}[${task.title}]`)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const data = e.dataTransfer.getData('text/plain')
    if (data) {
      setInputText((prev) => (prev ? `${prev} ${data}` : data))
    }
  }

  const currentProject = projects.find((p) => p.id === selectedProjectId)
  const filteredTasks = tasks
    .filter((t) => !selectedProjectId || t.projectId === selectedProjectId)
    .filter((t) => (activeTab === 'all' ? true : t.statusCode === activeTab))

  const awaitingCount = controlSnapshot.awaitingCount ?? 0
  const unknownCount = controlSnapshot.unknownCount ?? controlSnapshot.items.filter(item => item.state === 'unknown').length
  const isWorking = controlSnapshot.activeCount > 0 || controlSnapshot.queuedCount > 0 || awaitingCount > 0 || unknownCount > 0

  return (
    <div
      style={{
        // 作为 DSH 主面板渲染时铺满面板容器；不再用 fixed 覆盖层，避免遮挡宿主自身界面
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: '#ffffff',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
        color: '#1e293b',
        overflow: 'hidden',
      }}
    >
      {/* 顶部标题栏与全局状态 */}
      <div
        style={{
          height: '52px',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px',
          background: '#f8fafc',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>DSH Table 工作台</span>
            <span
              style={{
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '12px',
                background: '#dcfce7',
                color: '#15803d',
                fontWeight: 600,
              }}
            >
              {connection?.mode === 'client' ? connection.ready ? `Windows · ${connection.profile || '远程'} · ${String(connection.hostId || '').slice(0, 8)}` : '请先连接 Windows' : connection?.mode === 'host' ? 'Windows Host 权威' : '正在核验执行端'}
            </span>
          </div>
          {currentProject && (
            <span style={{ fontSize: '12px', color: '#64748b', background: '#f1f5f9', padding: '2px 8px', borderRadius: '4px' }}>
              物理根: {currentProject.rootPath}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={() => {
              loadData()
              loadControlSnapshot()
              loadChatMessages()
            }}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              fontSize: '12px',
              cursor: 'pointer',
              color: '#475569',
            }}
          >
            刷新数据
          </button>
          {onClose && (
            <button
              onClick={onClose}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: 'none',
                background: '#e2e8f0',
                fontSize: '12px',
                cursor: 'pointer',
                fontWeight: 600,
                color: '#334155',
              }}
            >
              返回对话
            </button>
          )}
        </div>
      </div>

      {/* 常驻工作控制条 (Independent Persistent Control Bar) */}
      <div
        style={{
          padding: '8px 20px',
          background: isWorking ? '#fff7ed' : '#f8fafc',
          borderBottom: '1px solid #fed7aa',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '13px',
          transition: 'background 0.2s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span
              style={{
                display: 'inline-block',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: isWorking ? '#f97316' : '#22c55e',
                boxShadow: isWorking ? '0 0 6px #f97316' : 'none',
              }}
            />
            <span style={{ fontWeight: 600, color: isWorking ? '#9a3412' : '#15803d' }}>
              {unknownCount > 0 ? '有工作等待核对' : awaitingCount > 0 ? '等待你的回复' : isWorking ? '工作推进中' : '执行控制就绪'}
            </span>
          </div>

          <span style={{ color: '#475569' }}>
            运行中: <strong>{controlSnapshot.activeCount}</strong> 项 · 排队中: <strong>{controlSnapshot.queuedCount}</strong> 项
            {awaitingCount > 0 && <> · 待回复: <strong>{awaitingCount}</strong> 项</>}
            {unknownCount > 0 && <> · 待核对: <strong>{unknownCount}</strong> 项</>}
          </span>

          {controlSnapshot.items.length > 0 && (
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              {controlSnapshot.items.slice(0, 2).map((item) => (
                <span
                  key={item.runId}
                  style={{
                    fontSize: '11px',
                    background: '#ffedd5',
                    color: '#c2410c',
                    padding: '2px 6px',
                    borderRadius: '4px',
                  }}
                >
                  {item.taskTitle ? item.taskTitle.slice(0, 14) : item.taskId.slice(0, 8)} ({runStateLabel(item.state)})
                </span>
              ))}
            </div>
          )}

          {actionFeedback && (
            <span style={{ color: '#0369a1', background: '#e0f2fe', padding: '2px 8px', borderRadius: '4px', fontSize: '11px' }}>
              {actionFeedback}
            </span>
          )}
        </div>

        {/* 独立控制动作按钮 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {unknownCount > 0 && (
            <button
              onClick={() => handleReconcileUncertain()}
              style={{
                padding: '4px 10px',
                borderRadius: '5px',
                border: '1px solid #d97706',
                background: '#fffbeb',
                color: '#b45309',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
              title="自动向宿主或操作员核验并解除待核对执行"
            >
              核验待核对 ({unknownCount})
            </button>
          )}

          {controlSnapshot.items.some(item => item.taskId === 'main-assistant' && item.state === 'unknown') && (
            <button onClick={abandonHost}>确认原宿主已退出</button>
          )}

          {controlSnapshot.activeCount > 0 && (
            <button
              onClick={() => handleStop({ kind: 'run', id: controlSnapshot.items[0]?.runId })}
              style={{
                padding: '4px 10px',
                borderRadius: '5px',
                border: '1px solid #f97316',
                background: '#ffffff',
                color: '#c2410c',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              停止当前任务
            </button>
          )}

          <button
            onClick={() => handleStop({ kind: 'all' })}
            style={{
              padding: '4px 12px',
              borderRadius: '5px',
              border: 'none',
              background: '#ef4444',
              color: '#ffffff',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 1px 2px rgba(239, 68, 68, 0.2)',
            }}
          >
            停止全部工作
          </button>
        </div>
      </div>

      {pendingInteractions.map(item => (
        <div key={item.id} style={{ padding: '12px 20px', background: '#fffbeb', borderBottom: '1px solid #fbbf24' }}>
          <strong>{item.title}</strong>
          {item.kind === 'approval' ? <span>
            <button onClick={() => respondInteraction(item, 'approve')}>批准本次</button>
            <button onClick={() => respondInteraction(item, 'reject')}>拒绝</button>
          </span> : <div>
            {item.questions.map((q: any) => <label key={q.id} style={{ display: 'block', marginTop: '8px' }}>
              {q.question || q.header || q.id}{q.detail && <pre style={{ whiteSpace: 'pre-wrap', maxHeight: '160px', overflow: 'auto' }}>{q.detail}</pre>}
              {q.options?.map((o: any) => <button key={o.label} onClick={() => setQuestionAnswers(values => ({ ...values, [item.id + q.id]: o.label }))}>{o.label}</button>)}
              <input placeholder="选择上方选项，或补充回答" value={questionAnswers[item.id + q.id] || ''} onChange={e => setQuestionAnswers(values => ({ ...values, [item.id + q.id]: e.target.value }))} />
            </label>)}
            <button onClick={() => respondInteraction(item)}>提交这组回答</button>
          </div>}
        </div>
      ))}
      {/* 主体三栏布局 */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* 左侧：项目列表 */}
        <div style={{ width: '220px', borderRight: '1px solid #e2e8f0', background: '#f8fafc', padding: '16px', overflowY: 'auto' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', marginBottom: '10px', textTransform: 'uppercase' }}>
            关联项目 ({projects.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {projects.map((p) => {
              const pTasks = tasks.filter((t) => t.projectId === p.id)
              const isSelected = selectedProjectId === p.id
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedProjectId(p.id)}
                  style={{
                    textAlign: 'left',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: 'none',
                    background: isSelected ? '#3b82f6' : 'transparent',
                    color: isSelected ? '#ffffff' : '#334155',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span style={{ fontSize: '13px', fontWeight: isSelected ? 600 : 500 }}>{p.title}</span>
                  <span style={{ fontSize: '11px', color: isSelected ? '#e0f2fe' : '#94a3b8' }}>
                    {pTasks.length} 项任务
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* 中间：多项目任务卡看板 */}
        <div style={{ flex: 1, borderRight: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', background: '#f1f5f9' }}>
          {/* 筛选标签栏 */}
          <div
            style={{
              padding: '12px 20px',
              background: '#ffffff',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', gap: '6px' }}>
              {(['all', 'todo', 'in_progress', 'review', 'done'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    padding: '4px 12px',
                    borderRadius: '16px',
                    border: 'none',
                    background: activeTab === tab ? '#0f172a' : '#f1f5f9',
                    color: activeTab === tab ? '#ffffff' : '#64748b',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  {tab === 'all' && '全部'}
                  {tab === 'todo' && '待办'}
                  {tab === 'in_progress' && '推进中'}
                  {tab === 'review' && '待验收'}
                  {tab === 'done' && '已完成'}
                </button>
              ))}
            </div>
            <span style={{ fontSize: '12px', color: '#94a3b8' }}>提示: 可直接拖拽卡片到右侧输入框引用</span>
          </div>

          {/* 任务卡平铺区 */}
          <div style={{ flex: 1, padding: '20px', overflowY: 'auto' }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>加载中...</div>
            ) : filteredTasks.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px', color: '#94a3b8' }}>
                当前分类下无任务卡，可在右侧主助理输入“新建任务：...”自动生成
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px' }}>
                {filteredTasks.map((task) => {
                  let badgeBg = '#f1f5f9'
                  let badgeColor = '#475569'
                  if (task.statusCode === 'done') {
                    badgeBg = '#dcfce7'
                    badgeColor = '#15803d'
                  } else if (task.statusCode === 'in_progress') {
                    badgeBg = '#dbeafe'
                    badgeColor = '#1d4ed8'
                  } else if (task.statusCode === 'review') {
                    badgeBg = '#fef3c7'
                    badgeColor = '#b45309'
                  } else if (task.statusCode === 'blocked') {
                    badgeBg = '#fee2e2'
                    badgeColor = '#b91c1c'
                  }

                  const matchingRunningItem = controlSnapshot.items.find((i) => i.taskId === task.id)
                  const matchingUncertainItem = controlSnapshot.items.find((i) => i.taskId === task.id && i.state === 'unknown')

                  return (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, task)}
                      style={{
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: '10px',
                        padding: '14px',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                        cursor: 'grab',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        minHeight: '130px',
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <span
                            style={{
                              fontSize: '11px',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              background: badgeBg,
                              color: badgeColor,
                              fontWeight: 600,
                            }}
                          >
                            {taskStatusLabel(task.statusCode)}
                          </span>
                          <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                            {task.updatedAt ? new Date(task.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                          </span>
                        </div>
                        <div style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a', marginBottom: '6px' }}>{task.title}</div>
                        {task.goal && (
                          <div style={{ fontSize: '12px', color: '#64748b', lineHeight: 1.4, marginBottom: '8px' }}>{task.goal}</div>
                        )}
                      </div>

                      <div
                        style={{
                          borderTop: '1px solid #f8fafc',
                          paddingTop: '8px',
                          marginTop: '4px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '11px', color: '#94a3b8' }}>优先级: {taskPriorityLabel(task.priorityCode)}</span>
                          {task.dependencies.length > 0 && (
                            <span style={{ fontSize: '11px', color: '#ef4444', fontWeight: 500 }}>
                              依赖: {task.dependencies.length} 项
                            </span>
                          )}
                        </div>

                        {/* 单卡操作按钮 */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setEditingTask(task)
                              setEditTitle(task.title)
                              setEditGoal(task.goal || '')
                              setEditAcceptance(task.acceptance || '')
                            }}
                            style={{
                              padding: '3px 8px',
                              fontSize: '11px',
                              borderRadius: '4px',
                              border: '1px solid #cbd5e1',
                              background: '#f8fafc',
                              color: '#475569',
                              cursor: 'pointer',
                              fontWeight: 500,
                            }}
                          >
                            编辑/补充材料
                          </button>
                          {task.statusCode === 'in_progress' ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                if (matchingRunningItem) {
                                  handleStop({ kind: 'run', id: matchingRunningItem.runId })
                                } else {
                                  handleStop({ kind: 'all' })
                                }
                              }}
                              style={{
                                padding: '3px 8px',
                                fontSize: '11px',
                                borderRadius: '4px',
                                border: '1px solid #ef4444',
                                background: '#fff',
                                color: '#ef4444',
                                cursor: 'pointer',
                                fontWeight: 600,
                              }}
                            >
                              停止执行
                            </button>
                          ) : matchingUncertainItem ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleReconcileUncertain(matchingUncertainItem.runId)
                              }}
                              style={{
                                padding: '3px 8px',
                                fontSize: '11px',
                                borderRadius: '4px',
                                border: '1px solid #d97706',
                                background: '#fffbeb',
                                color: '#b45309',
                                cursor: 'pointer',
                                fontWeight: 600,
                              }}
                              title="解除未知执行保护，恢复为待办"
                            >
                              解除待核对
                            </button>
                          ) : task.statusCode !== 'done' ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleStartTaskRun(task.id)
                              }}
                              style={{
                                padding: '3px 8px',
                                fontSize: '11px',
                                borderRadius: '4px',
                                border: '1px solid #3b82f6',
                                background: '#3b82f6',
                                color: '#fff',
                                cursor: 'pointer',
                                fontWeight: 600,
                              }}
                            >
                              推进该任务
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* 右侧：单主助理入口 */}
        <div style={{ width: '420px', display: 'flex', flexDirection: 'column', background: '#ffffff' }}>
          <div
            style={{
              height: '48px',
              borderBottom: '1px solid #e2e8f0',
              padding: '0 16px',
              display: 'flex',
              alignItems: 'center',
              fontWeight: 600,
              fontSize: '14px',
              background: '#f8fafc',
              color: '#334155',
            }}
          >
            主助理对话与执行协同
          </div>

          {/* 对话消息列表 */}
          <div
            style={{
              flex: 1,
              padding: '16px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              background: '#f8fafc',
            }}
          >
            {messages.map((m) => {
              const isUser = m.sender === 'user'
              const timeStr = m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
              return (
                <div
                  key={m.id}
                  style={{
                    alignSelf: isUser ? 'flex-end' : 'flex-start',
                    maxWidth: '88%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: isUser ? 'flex-end' : 'flex-start',
                  }}
                >
                  <div
                    style={{
                      padding: '10px 14px',
                      borderRadius: isUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                      fontSize: '13px',
                      lineHeight: 1.5,
                      background: isUser ? '#2563eb' : '#ffffff',
                      color: isUser ? '#ffffff' : '#1e293b',
                      border: isUser ? 'none' : '1px solid #e2e8f0',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {m.text}
                  </div>
                  <span style={{ fontSize: '10px', color: '#94a3b8', marginTop: '4px' }}>{timeStr}</span>
                </div>
              )
            })}
          </div>

          {/* 底部输入框 */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            style={{
              padding: '14px',
              borderTop: '1px solid #e2e8f0',
              background: '#ffffff',
            }}
          >
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder="输入聊天内容、拖入任务卡或键入 @任务卡 并说“推进”..."
              rows={3}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '10px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                resize: 'none',
                fontSize: '13px',
                outline: 'none',
                fontFamily: 'inherit',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>Enter 发送 · Shift+Enter 换行</span>
              <button
                disabled={sending}
                onClick={handleSend}
                style={{
                  padding: '6px 16px',
                  borderRadius: '6px',
                  background: sending ? '#94a3b8' : '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: sending ? 'not-allowed' : 'pointer',
                }}
              >
                {sending ? '处理中...' : '发送指令'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 任务编辑与材料补充弹窗 */}
      {editingTask && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setEditingTask(null)}
        >
          <div
            style={{
              width: '560px',
              maxWidth: '90vw',
              background: '#ffffff',
              borderRadius: '12px',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px', color: '#0f172a' }}>
              编辑任务卡与补充材料
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                任务标题
              </label>
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              />
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                任务目标与会议/业务材料（可直接粘贴会议发言、需求文档）
              </label>
              <textarea
                rows={6}
                value={editGoal}
                onChange={(e) => setEditGoal(e.target.value)}
                placeholder="在此粘贴会议记录、需求要点或原始材料..."
                style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', resize: 'vertical' }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                验收标准
              </label>
              <input
                type="text"
                value={editAcceptance}
                onChange={(e) => setEditAcceptance(e.target.value)}
                placeholder="例如：包含会议主题、各人发言要点、行动项待办表"
                style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                onClick={() => setEditingTask(null)}
                style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff', cursor: 'pointer', fontSize: '13px' }}
              >
                取消
              </button>
              <button
                onClick={handleSaveTaskEdit}
                style={{ padding: '8px 18px', borderRadius: '6px', border: 'none', background: '#3b82f6', color: '#ffffff', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}
              >
                保存更新
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ================= DSH 客户端插件装配 =================

/**
 * 面板级错误边界：任务台自身的渲染异常降级为一张可重试的错误卡，
 * 绝不让异常冒泡炸掉宿主整个 Web 壳（面板只是宿主 UI 的一个插槽）。
 * 导出供面板契约回归测试直接验证 getDerivedStateFromError 行为。
 */
export class PanelErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '24px', color: '#b91c1c', fontSize: '14px', lineHeight: 1.7 }}>
          <div style={{ fontWeight: 700, marginBottom: '8px' }}>任务台加载出现问题</div>
          <div style={{ color: '#64748b', marginBottom: '12px' }}>{String(this.state.error?.message ?? this.state.error)}</div>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ padding: '6px 14px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}
          >
            重试
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export const name = 'workbench'
export const inject = ['slots', 'layout']

export function apply(ctx: any): () => void {
  const slots = ctx.slots
  const layout = ctx.layout
  const disposers: Array<() => void> = []

  // DSH 客户端契约（宿主自带文档）：全局面板入口在 root 作用域的 `sidebar.panellist`
  // 注册图标，同一 id 还必须注册到 root 作用域的 `main` keyed slot 才会渲染；
  // 只注册图标而不注册 main 时，点击会抛“主面板条目不存在”并保留当前面板。
  // 因此这里成对注册：图标只负责 layout.selectPanel，内容由 main 槽承载。
  if (slots && typeof slots.inject === 'function') {
    try {
      const d1 = slots.inject('main', () =>
        slots.register({ name: 'main', key: PANEL_ID, label: ENTRY_TITLE }, () => (
          <PanelErrorBoundary>
            <WorkbenchView />
          </PanelErrorBoundary>
        )),
      )
      if (typeof d1 === 'function') disposers.push(d1)
    } catch (err) {
      console.warn('[workbench] Failed to register main panel:', err)
    }

    try {
      const d2 = slots.inject('sidebar.panellist', () =>
        slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: -4, label: ENTRY_TITLE }, () => (
          <button
            onClick={() => {
              if (layout && typeof layout.selectPanel === 'function') layout.selectPanel(PANEL_ID)
            }}
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '8px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'currentColor',
            }}
            title={ENTRY_TITLE}
            aria-label={ENTRY_TITLE}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
              <line x1="9" y1="9" x2="21" y2="9" />
            </svg>
          </button>
        )),
      )
      if (typeof d2 === 'function') disposers.push(d2)
    } catch (err) {
      console.warn('[workbench] Failed to register sidebar.panellist:', err)
    }
  }

  return () => {
    for (const d of disposers) d()
  }
}
