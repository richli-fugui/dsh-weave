import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { openWorkbenchDb } from '../lib/host/db/database.js'
import { WorkbenchDomain } from '../lib/host/services/domain.js'
import { WorkbenchContextManager } from '../lib/host/services/context.js'
import { apply } from '../lib/index.js'

// ============================================================
// 连续性回归：历史分页必须取“最近 N 条”而非“最早 N 条”
// 对应 handoff T-001 / T1：超过 100 条后的最新事实、两轮指代、重启后连续性
// ============================================================

test('A. 聊天历史分页取最近 N 条（超过 100 条后最新事实不丢失）', () => {
  const db = openWorkbenchDb({ dbPath: ':memory:' })
  const domain = new WorkbenchDomain(db)

  // 连续写入 105 条（同一毫秒内批量写入，检验稳定排序）
  for (let i = 1; i <= 105; i++) {
    domain.saveChatMessage('user', `消息-${i}`)
  }

  const latest = domain.listChatMessages(100)
  assert.equal(latest.length, 100, '应返回最近 100 条')
  assert.equal(latest[0].text, '消息-6', '最早一条应为第 6 条（前 5 条被分页淘汰）')
  assert.equal(latest[99].text, '消息-105', '最后一条必须是最新的第 105 条')
  assert.equal(latest.some((m) => m.text === '消息-1'), false, '不得残留最早的历史消息')
  assert.equal(latest.some((m) => m.text === '消息-104'), true, '最新附近消息必须存在')

  // 顺序必须为时间正序（前端按序渲染）
  for (let i = 1; i < latest.length; i++) {
    assert.ok(latest[i - 1].createdAt <= latest[i].createdAt, '返回必须按时间正序')
  }
})

// B 组（stub 桥接捕获模型请求）已随 WorkBuddy 桥接移除（0.1.2）：
// 模型上下文权威在宿主会话（raw 输入模式），由 scripts/verify-host-continuity.mjs 真机覆盖。

test('C. Token 预算裁剪将尾注计入完整输入，任何档位均不超限', () => {
  const db = openWorkbenchDb({ dbPath: ':memory:' })
  const domain = new WorkbenchDomain(db)
  const ctxMgr = new WorkbenchContextManager(domain)

  const p = domain.createProject({ id: 'bp', title: '预算项目', rootPath: 'C:\\projects\\bp' })
  // 引用任务目标/验收留空 -> 行粒度细，便于暴露“尾注追加后超限”
  domain.createTask({ id: 'bt', projectId: p.id, title: '长目标任务' })
  for (let i = 1; i <= 10; i++) {
    domain.createProject({ id: `px-${i}`, title: `陪衬项目-${i}`, rootPath: `C:\\projects\\px-${i}` })
  }

  // 不可约下限 = 核心身份块 + 尾注 ≈ 81 tokens（estimateTokens 启发式）；
  // 扫描从 85 起，验证一切可满足档位下“完整输入（含尾注）”严格不超限
  let checked = 0
  for (let budget = 85; budget <= 400; budget += 1) {
    const out = ctxMgr.buildBoundedContext('bp', ['bt'], { maxPromptTokens: budget })
    const est = ctxMgr.estimateTokens(out)
    assert.ok(est <= budget, `预算 ${budget} 下完整输入（含尾注）估算 ${est} 超限`)
    checked++
  }
  assert.ok(checked > 300, '必须扫描足够多的预算档位')
})

// ============================================================
// 会话轮换：verifier 必须被真实调用，失败必须拒绝轮换（T-004）
// ============================================================

test('D. 会话轮换验证器接线与模式标注', async () => {
  const db = openWorkbenchDb({ dbPath: ':memory:' })
  const domain = new WorkbenchDomain(db)
  const ctxMgr = new WorkbenchContextManager(domain)

  // D1: verifier 被真实调用，模式标记为 dsh-session-controller
  let verifiedId = null
  const rotated = await ctxMgr.rotateSession('main-assistant', 'real-session-42', async (id) => {
    verifiedId = id
    return true
  })
  assert.equal(verifiedId, 'real-session-42', 'verifier 必须收到目标 Session ID')
  assert.equal(rotated.currentSessionId, 'real-session-42')
  assert.equal(rotated.generation, 2)
  assert.equal(rotated.memoryIndex.handover.sessionMode, 'dsh-session-controller', '验证通过必须标注真实绑定模式')

  // D2: verifier 返回 false -> 拒绝轮换，generation 不得推进
  await assert.rejects(
    () => ctxMgr.rotateSession('main-assistant', 'real-session-43', async () => false),
    /未通过宿主可用性验证/,
    '目标会话未通过验证时必须拒绝轮换',
  )
  const afterReject = domain.getAssistantState('main-assistant')
  assert.equal(afterReject.generation, 2, '验证失败不得推进代次')
  assert.equal(afterReject.currentSessionId, 'real-session-42', '验证失败不得切换会话')

  // D3: 无 verifier -> 自管模式 + 合成 ID（准确命名，不冒充已验证会话）
  const selfManaged = await ctxMgr.rotateSession('main-assistant')
  assert.equal(selfManaged.generation, 3)
  assert.ok(selfManaged.currentSessionId.startsWith('session-gen3-'), '自管模式应合成可识别 ID')
  assert.equal(selfManaged.memoryIndex.handover.sessionMode, 'self-managed-state')

  // D4: 空串 / 同 ID 仍被拒绝
  await assert.rejects(() => ctxMgr.rotateSession('main-assistant', '   '), /非空有效字符串/)
  await assert.rejects(() => ctxMgr.rotateSession('main-assistant', selfManaged.currentSessionId), /不得与当前活跃/)
})
