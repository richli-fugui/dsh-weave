import test from 'node:test'
import assert from 'node:assert/strict'
import { DshHostSessionBridge, probeHostServices } from '../lib/host/services/host-session.js'

/**
 * T-001/T-004：宿主 SessionController 桥接的替身层语义测试。
 * 证据层 = UNIT/MOCK。真实宿主行为由隔离/真实实例验证取证（轮次记录 §4）。
 * v2（2026-10-24 晚）：事件读取改为 resolveAgent → agent.session.snapshotEvents()
 * （真机实证 page throughSeq:-1 在宿主 paginate 中得到空页）。
 */

// 事件工厂：原始事件形状（snapshotEvents 返回），也兼容 page 包装形态的提取
function ev(seq, type, data = {}) {
  return { type, seq, time: 1792845953000 + seq, data }
}

function textEvent(seq, type, text, extraData = {}) {
  return ev(seq, type, { content: text === undefined ? [] : [{ type: 'text', text }], ...extraData })
}

function attemptEvent(seq, finishReason) {
  return ev(seq, 'assistant/attempt', {
    turn: 1, step: 1,
    stream: [{ type: 'chunk', time: 0, chunk: { type: 'finish', reason: finishReason } }],
  })
}

function makeController(overrides = {}) {
  let events = []
  const controller = {
    prompt: async (req, signal) => ({ accepted: true }),
    resolveAgent: async (id) => ({ agent: { id, status: 'idle', session: { snapshotEvents: () => [...events] } } }),
    // 宿主公开面：create → { sessionId }（SessionController.create）
    create: async () => ({ sessionId: 'session-test-1' }),
    page: async () => ({ records: [], hasMore: false }),
    cancel: async () => ({ accepted: true }),
    ...overrides,
  }
  controller.__setEvents = (next) => { events = next }
  return controller
}

test('宿主会话桥接（sessionController）替身层语义', async (t) => {
  await t.test('1. 能力探测：方法面齐全才可用，缺任一方法返回 null', () => {
    assert.ok(DshHostSessionBridge.probe(makeController()))
    assert.equal(DshHostSessionBridge.probe(null), null)
    assert.equal(DshHostSessionBridge.probe({}), null)
    assert.equal(DshHostSessionBridge.probe(makeController({ page: undefined })), null)
    assert.equal(DshHostSessionBridge.probe(makeController({ prompt: undefined })), null)
    assert.equal(DshHostSessionBridge.probe(makeController({ resolveAgent: undefined })), null)
    assert.equal(DshHostSessionBridge.probe(makeController({ create: undefined, createSession: undefined })), null)
  })

  await t.test('2. 既有会话复活复用：resolveAgent 返回 agent 时 created=false', async () => {
    const calls = { resolve: 0 }
    const controller = makeController({
      resolveAgent: async (id) => {
        calls.resolve++
        return { agent: { id, status: 'idle', session: { snapshotEvents: () => [] } } }
      },
    })
    const bridge = DshHostSessionBridge.probe(controller)
    const r = await bridge.ensureSession('session-existing', { cwd: 'C:\\tmp\\w' })
    assert.equal(r.sessionId, 'session-existing')
    assert.equal(r.created, false)
    assert.equal(r.verified, true)
    assert.equal(calls.resolve, 1)
  })

  await t.test('3. 既有会话不可用（error）时创建新会话并二次确认', async () => {
    let created = 0
    const controller = makeController({
      resolveAgent: async (id) => {
        if (id === 'session-dead') return { error: { message: 'session/not-found' } }
        return { agent: { id, status: 'idle', session: { snapshotEvents: () => [] } } }
      },
      create: async (req) => {
        created++
        assert.deepEqual(req, { cwd: 'C:\\tmp\\w' })
        return { sessionId: 'session-fresh-1' }
      },
    })
    const bridge = DshHostSessionBridge.probe(controller)
    const r = await bridge.ensureSession('session-dead', { cwd: 'C:\\tmp\\w' })
    assert.equal(r.created, true)
    assert.equal(r.sessionId, 'session-fresh-1')
    assert.equal(r.verified, true)
    assert.equal(created, 1)
  })

  await t.test('3b. 仅暴露内部 createSession 形状时兼容可用', async () => {
    const controller = makeController({
      create: undefined,
      createSession: async () => ({ agent: { id: 'session-legacy-1' } }),
    })
    const bridge = DshHostSessionBridge.probe(controller)
    const r = await bridge.ensureSession(undefined, { cwd: 'C:\\tmp\\w' })
    assert.equal(r.sessionId, 'session-legacy-1')
    assert.equal(r.created, true)
  })

  await t.test('4. 显式模型经 selectForNextRequest 做 per-session 选择；复用会话同样 pin（v2）', async () => {
    const pinned = []
    const controller = makeController({
      resolveAgent: async (id) => ({ agent: { id, status: 'idle', session: { snapshotEvents: () => [] } } }),
      agents: { selectForNextRequest: (agent, selection) => pinned.push({ agent: agent.id, selection }) },
    })
    const bridge = DshHostSessionBridge.probe(controller)
    // 创建路径 pin
    await bridge.ensureSession(undefined, { cwd: 'C:\\tmp\\w', model: { provider: 'workbuddy-bridge', model: 'deepseek-v4.1-flash' } })
    assert.equal(pinned.length, 1)
    assert.deepEqual(pinned[0], { agent: 'session-test-1', selection: { provider: 'workbuddy-bridge', model: 'deepseek-v4.1-flash' } })
    // 复用路径也 pin（会话可能创建于无 pin/默认路由不可用的环境）
    await bridge.ensureSession('session-existing', { cwd: 'C:\\tmp\\w', model: { provider: 'openai-codex', model: 'gpt-6-luna' } })
    assert.equal(pinned.length, 2)
    assert.deepEqual(pinned[1], { agent: 'session-existing', selection: { provider: 'openai-codex', model: 'gpt-6-luna' } })

    const controllerNoPin = makeController()
    const bridge2 = DshHostSessionBridge.probe(controllerNoPin)
    const r2 = await bridge2.ensureSession(undefined, { cwd: 'C:\\tmp\\w', model: { provider: 'p', model: 'm' } })
    assert.equal(r2.verified, true)
  })

  await t.test('5. sendAndCollect：prompt 形状正确、只认基线之后的 assistant/message、提取 text 分块', async () => {
    let promptReq = null
    let promptSignal = null
    const beforeEvents = [
      textEvent(10, 'assistant/message', '旧回复'),
      textEvent(11, 'user/message', undefined, { source: { kind: 'user', rpcId: 'old' } }),
    ]
    const afterEvents = [
      ...beforeEvents,
      ev(12, 'assistant/message', { message: { content: [
        { type: 'reasoning', text: '内部推理不应出现在正文' },
        { type: 'text', text: '这是宿主的真实回复' },
      ] } }),
    ]
    const controller = makeController()
    const realResolve = controller.resolveAgent
    let promptFired = false
    let sawRunning = false
    controller.resolveAgent = async (id) => {
      if (promptFired && !sawRunning) {
        // 第一轮轮询时仍处 running，此后轮次回合已完成（事件切换到 after）
        sawRunning = true
        return { agent: { ...(await realResolve(id)).agent, status: 'running' } }
      }
      controller.__setEvents(promptFired ? afterEvents : beforeEvents)
      const r = await realResolve(id)
      return { agent: { ...r.agent, status: promptFired ? 'idle' : 'idle' } }
    }
    controller.prompt = async (req, signal) => {
      promptReq = req
      promptSignal = signal
      promptFired = true
      return { accepted: true }
    }
    const bridge = DshHostSessionBridge.probe(controller, { pollIntervalMs: 10 })
    controller.__setEvents(beforeEvents)
    const r = await bridge.sendAndCollect('session-x', '你好', { replyTimeoutMs: 3000 })
    assert.equal(r.status, 'replied')
    assert.equal(r.replyText, '这是宿主的真实回复')
    assert.equal(r.requestAccepted, true)
    // prompt 请求形状
    assert.equal(promptReq.sessionId, 'session-x')
    assert.equal(promptReq.mode, 'followup')
    assert.equal(typeof promptReq.requestId, 'string')
    assert.deepEqual(promptReq.content, [{ type: 'text', text: '你好' }])
    assert.ok(promptSignal instanceof AbortSignal)
    assert.equal(promptReq.clientTimeZone, 'Asia/Shanghai')
  })

  await t.test('5b. page 的 {type:"event",event} 包装记录同样可提取（兼容形态）', () => {
    const wrapped = [
      { type: 'event', event: ev(5, 'assistant/message', { message: { content: [{ type: 'text', text: '包装回复' }] } }) },
    ]
    const bridge = DshHostSessionBridge.probe(makeController())
    // 通过公开静态验证 unwrap 逻辑
    const unwrapped = bridge.constructor.unwrapEventOf(wrapped[0])
    assert.equal(unwrapped.type, 'assistant/message')
  })

  await t.test('6. 超时如实上报，不伪造回复', async () => {
    const controller = makeController({
      resolveAgent: async (id) => ({ agent: { id, status: 'running', session: { snapshotEvents: () => [] } } }),
      prompt: async () => ({ accepted: true }),
    })
    const bridge = DshHostSessionBridge.probe(controller, { pollIntervalMs: 10 })
    const r = await bridge.sendAndCollect('session-y', '长任务', { replyTimeoutMs: 120 })
    assert.equal(r.status, 'timeout')
    assert.equal(r.requestAccepted, true)
    assert.equal(r.replyText, undefined)
  })

  await t.test('7. 回合收敛但无正文且模型层报错：错误信息如实透出（v2）', async () => {
    const controller = makeController()
    const realResolve = controller.resolveAgent
    let running = true
    controller.resolveAgent = async (id) => {
      if (!running) {
        controller.__setEvents([
          textEvent(10, 'assistant/message', '旧回复'),
          textEvent(11, 'user/message', undefined),
          attemptEvent(12, { kind: 'error', failure: { message: '400: upstream Illegal API invocation (code 11128)' } }),
        ])
      }
      const r = await realResolve(id)
      return { agent: { ...r.agent, status: running ? 'running' : 'idle' } }
    }
    controller.prompt = async () => {
      controller.__setEvents([textEvent(10, 'assistant/message', '旧回复')])
      return { accepted: true }
    }
    const bridge = DshHostSessionBridge.probe(controller, { pollIntervalMs: 10 })
    // 基线在 sendAndCollect 内部先于 prompt 计算：旧事件必须提前就位
    controller.__setEvents([textEvent(10, 'assistant/message', '旧回复'), textEvent(11, 'user/message', undefined)])
    setTimeout(() => { running = false }, 60)
    const r = await bridge.sendAndCollect('session-z', '查一下', { replyTimeoutMs: 8000 })
    assert.equal(r.status, 'accepted_no_reply_yet')
    assert.match(r.error, /模型层错误/)
    assert.match(r.error, /11128/)
  })

  await t.test('8. 宿主拒绝/异常：error 带原始信息，不重发', async () => {
    let promptCalls = 0
    const controller = makeController({
      prompt: async () => {
        promptCalls++
        throw new Error('session/model-unavailable')
      },
    })
    const bridge = DshHostSessionBridge.probe(controller)
    const r = await bridge.sendAndCollect('session-e', 'hi', { replyTimeoutMs: 200 })
    assert.equal(r.status, 'error')
    assert.match(r.error, /model-unavailable/)
    assert.equal(promptCalls, 1)
  })

  await t.test('9. probeHostServices：有 reflect 时如实上报 found 与方法面；异常不外抛', () => {
    const sessionController = makeController()
    const ctx = {
      reflect: {
        get: (name) => (name === 'sessionController' ? sessionController : undefined),
      },
    }
    const { services } = probeHostServices(ctx)
    const sc = services.find((s) => s.name === 'sessionController')
    assert.ok(sc.found)
    assert.match(sc.detail, /prompt/)
    const missing = services.filter((s) => !s.found).map((s) => s.name)
    assert.ok(missing.includes('agents') || missing.length > 0)
    const empty = probeHostServices({})
    assert.ok(Array.isArray(empty.services))
  })

  await t.test('10. cancel 能力存在时可用，异常时返回 false', async () => {
    const bridge = DshHostSessionBridge.probe(makeController())
    assert.equal(await bridge.cancel('session-c'), true)
    const bridgeNoCancel = DshHostSessionBridge.probe(makeController({ cancel: undefined }))
    assert.equal(await bridgeNoCancel.cancel('session-c'), false)
  })
})
