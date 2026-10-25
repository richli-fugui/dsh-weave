import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { openWorkbenchDb } from '../lib/host/db/database.js'
import {
  WorkbenchDomain,
  HostSessionTracker,
  DshHostSessionBridge,
  LocalProvider,
  apply,
} from '../lib/index.js'

function createMockController(initialAgentStatus = 'idle') {
  let agentStatus = initialAgentStatus
  const events = []
  let currentSeq = 1
  let promptCount = 0
  let cancelCalled = false
  let onPrompt = null

  const agent = {
    id: `session-mock-${randomUUID()}`,
    status: agentStatus,
    session: {
      snapshotEvents: () => [...events],
    },
  }

  const controller = {
    get agentStatus() {
      return agentStatus
    },
    set agentStatus(s) {
      agentStatus = s
      agent.status = s
    },
    get promptCount() {
      return promptCount
    },
    get cancelCalled() {
      return cancelCalled
    },
    set onPrompt(fn) {
      onPrompt = fn
    },
    addEvent(type, data) {
      events.push({ seq: currentSeq++, type, data })
    },
    async resolveAgent(id) {
      return { ok: true, agent }
    },
    async create() {
      return { sessionId: agent.id }
    },
    async prompt(req) {
      promptCount++
      events.push({ seq: currentSeq++, type: 'user/message', data: req })
      if (onPrompt) onPrompt()
      return { accepted: true }
    },
    async cancel(req) {
      cancelCalled = true
      agentStatus = 'idle'
      agent.status = 'idle'
      return { accepted: true }
    },
    async page() {
      return { records: events.map((e) => ({ type: 'event', event: e })), hasMore: false }
    },
  }

  return { controller, agent }
}

test('T-017 (1/5): 宿主 awaiting_input 提问识别并投影至控制快照', async () => {
  const { controller, agent } = createMockController('running')
  const db = openWorkbenchDb({ dbPath: ':memory:' })
  const domain = new WorkbenchDomain(db)
  const bridge = DshHostSessionBridge.probe(controller)
  assert.ok(bridge, 'bridge 探测应成功')

  const tracker = new HostSessionTracker(domain, () => bridge)
  const provider = new LocalProvider(domain, undefined, undefined, tracker)

  // 模拟发送 prompt 后宿主转为 awaiting_input 并发出提问事件
  controller.onPrompt = () => {
    controller.agentStatus = 'awaiting_input'
    controller.addEvent('assistant/message', {
      message: { content: [{ type: 'text', text: '需要您确认：是否继续处理第 2 个文件？' }] },
    })
  }

  tracker.recordTurnStarted({
    sessionId: agent.id,
    requestId: 'req-awaiting-test',
    baselineMaxSeq: 0,
  })

  const turn = await bridge.sendAndCollect(agent.id, '推进文件处理', { replyTimeoutMs: 3000 })
  assert.equal(turn.status, 'awaiting_input')
  assert.match(turn.replyText, /需要您确认/)

  await tracker.recordTurnAwaitingInput(turn.replyText)

  // 核对控制快照
  const snapshot = await provider.getControlSnapshot()
  assert.equal(snapshot.awaitingCount, 1, 'awaitingCount 应为 1')
  const awaitingItem = snapshot.items.find((i) => i.state === 'awaiting_input')
  assert.ok(awaitingItem, '控制快照中应存在 awaiting_input 项')
  assert.match(awaitingItem.taskTitle, /确认/)

  db.close()
})

// This creates a separate tracker from apply(). It covers generic host prompt routing only;
// it does not prove the pending branch or native question/permission response semantics.
test('T-017 (2/5): 通用主入口输入到达宿主 prompt（不证明原生 pending 作答）', async () => {
  const { controller, agent } = createMockController('idle')
  const db = openWorkbenchDb({ dbPath: ':memory:' })
  const domain = new WorkbenchDomain(db)
  const bridge = DshHostSessionBridge.probe(controller)
  const tracker = new HostSessionTracker(domain, () => bridge)

  // 预先建立 assistant_state
  domain.getAssistantState('main-assistant')

  // 记录处于 awaiting_input
  tracker.recordTurnStarted({
    sessionId: agent.id,
    requestId: 'req-1',
    intentId: 'intent-test',
    baselineMaxSeq: 0,
  })
  await tracker.recordTurnAwaitingInput('请选择处理方式：A 或 B？')

  // 验证当前处于待决状态
  const pending = tracker.getPendingTurn()
  assert.ok(pending)
  assert.equal(pending.status, 'awaiting_input')

  const routes = new Map()
  const mockCtx = {
    webServer: {
      post(path, handler) {
        routes.set(`POST ${path}`, handler)
      },
      get(path, handler) {
        routes.set(`GET ${path}`, handler)
      },
    },
    sessionController: controller,
  }

  // 宿主在收到回答后转为 replied
  controller.onPrompt = () => {
    controller.agentStatus = 'idle'
    controller.addEvent('assistant/message', {
      message: { content: [{ type: 'text', text: '已收到您的选择 A，正在为您执行。' }] },
    })
  }

  apply(mockCtx, { dbPath: ':memory:' })
  const sendHandler = routes.get('POST /api/workbench/chat/send')
  assert.ok(sendHandler)

  let sentJson = null
  const res = {
    json(data) {
      sentJson = data
    },
    status() {
      return this
    },
  }

  // 发送用户作答
  await sendHandler({ body: { text: '选择方式 A' } }, res)
  assert.ok(sentJson, '应返回 JSON 响应')
  assert.match(sentJson.reply.text, /已收到您的选择 A/)

  // 宿主 prompt 被调用（回答成功送达）
  assert.ok(controller.promptCount >= 1, 'prompt 应被调用送达用户回答')

  db.close()
})

test('T-017 (3/5): 待决或推进中统一停止联动：停止命令同步调用 bridge.cancel', async () => {
  const { controller, agent } = createMockController('awaiting_input')
  const db = openWorkbenchDb({ dbPath: ':memory:' })
  const domain = new WorkbenchDomain(db)
  const bridge = DshHostSessionBridge.probe(controller)
  const tracker = new HostSessionTracker(domain, () => bridge)
  const provider = new LocalProvider(domain, undefined, undefined, tracker)

  tracker.recordTurnStarted({
    sessionId: agent.id,
    requestId: 'req-stop-test',
    baselineMaxSeq: 0,
  })
  await tracker.recordTurnAwaitingInput('是否确认继续？')

  // 执行 stopAll
  const stopRes = await provider.stopAll()
  assert.equal(stopRes.status, 'stopped')
  assert.equal(controller.cancelCalled, true, '宿主 controller.cancel 应被联动调用')
  assert.equal(tracker.getPendingTurn(), null, '待决轮次应收敛清空')

  const snapshot = await provider.getControlSnapshot()
  assert.equal(snapshot.awaitingCount, 0, '停止后 awaitingCount 应为 0')

  db.close()
})

test('T-017 (4/5): 晚到回复后台跟踪：HTTP 结束后晚到正文自动回流聊天流与 Outbox', async () => {
  const { controller, agent } = createMockController('running')
  const db = openWorkbenchDb({ dbPath: ':memory:' })
  const domain = new WorkbenchDomain(db)
  const bridge = DshHostSessionBridge.probe(controller)
  const tracker = new HostSessionTracker(domain, () => bridge, { pollIntervalMs: 20 })

  tracker.recordTurnStarted({
    sessionId: agent.id,
    requestId: 'req-late',
    intentId: 'intent-late-1',
    baselineMaxSeq: 0,
  })

  // 启动后台跟踪
  tracker.startBackgroundTracking(agent.id, 0, 'intent-late-1')

  // 模拟在后台延迟 30ms 后产生晚到正文并退出 idle
  setTimeout(() => {
    controller.addEvent('assistant/message', {
      message: { content: [{ type: 'text', text: '这是后台延迟产出的最终方案材料。' }] },
    })
    controller.agentStatus = 'idle'
  }, 30)

  // 等待后台轮询捕获
  await new Promise((r) => setTimeout(r, 150))

  const messages = await domain.listChatMessages()
  const lateMsg = messages.find((m) => m.text.includes('后台延迟产出'))
  assert.ok(lateMsg, '晚到回复应被后台跟踪捕获并存入聊天历史')
  assert.equal(lateMsg.sender, 'assistant')

  const outbox = domain.listOutboxEvents()
  const lateEvent = outbox.find((e) => e.type === 'assistant.late_reply')
  assert.ok(lateEvent, '应产生 assistant.late_reply 出件箱事件')

  tracker.stopBackgroundTracking()
  db.close()
})

test('T-017 (5/5): 重启无双发与待决对账：重启只核验宿主状态，绝不重发 Prompt', async () => {
  const { controller, agent } = createMockController('idle')
  const db = openWorkbenchDb({ dbPath: ':memory:' })
  const domain = new WorkbenchDomain(db)

  // 确保 assistant_state 行已建立
  domain.getAssistantState('main-assistant')

  // 模拟重启前持久化的 pending 状态
  const pendingState = {
    sessionId: agent.id,
    requestId: 'req-startup-reconcile',
    intentId: 'intent-reconcile',
    baselineMaxSeq: 0,
    startedAt: new Date().toISOString(),
    status: 'running',
  }
  db.prepare('UPDATE assistant_state SET memory_index_json = ? WHERE stable_id = ?').run(
    JSON.stringify({ pendingHostTurn: pendingState }),
    'main-assistant',
  )

  // 宿主在关机期间已产生回复并 idle
  controller.addEvent('assistant/message', {
    message: { content: [{ type: 'text', text: '关机期间已完成的答复。' }] },
  })

  const bridge = DshHostSessionBridge.probe(controller)
  const tracker = new HostSessionTracker(domain, () => bridge)

  // 执行重启对账
  await tracker.reconcileOnStartup()

  // 关键保证：重启绝不重发 Prompt（promptCount 必须为 0）
  assert.equal(controller.promptCount, 0, '重启对账绝不重复发送 Prompt（重启无双发）')

  // 且遗漏的答复被自动收回
  const messages = await domain.listChatMessages()
  const reconciledMsg = messages.find((m) => m.text.includes('关机期间已完成'))
  assert.ok(reconciledMsg, '关机期间完成的答复应被安全收录')

  db.close()
})
