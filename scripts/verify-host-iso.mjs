// T-009 隔离 profile 真实宿主验证脚本（只读+受控写入，全部走已启动宿主的公开 API）。
// 用法：node scripts/verify-host-iso.mjs <port> <token> <outJsonPath>
// 证据文件脱敏：不含 token、不含机器特定绝对路径（路径以 ~ 缩写）。
import { writeFileSync } from 'node:fs'

const [, , portArg, tokenArg, outPath] = process.argv
const port = Number(portArg)
const base = `http://127.0.0.1:${port}`
const results = []
const homedirRe = new RegExp(process.env.USERPROFILE?.replace(/\\/g, '/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') || '~~', 'g')
const sanitize = (v) => {
  if (typeof v === 'string') return v.replace(homedirRe, '~').replace(/token=[A-Za-z0-9_-]+/g, 'token=REDACTED')
  if (Array.isArray(v)) return v.map(sanitize)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sanitize(x)]))
  return v
}

async function record(name, fn) {
  const started = new Date().toISOString()
  try {
    const detail = await fn()
    results.push({ name, status: 'PASS', startedAt: started, detail: sanitize(detail) })
    console.log(`PASS ${name}`)
  } catch (err) {
    results.push({ name, status: 'FAIL', startedAt: started, error: sanitize(String(err?.message || err)) })
    console.log(`FAIL ${name}: ${err?.message || err}`)
  }
}

async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data = text
  try { data = JSON.parse(text) } catch {}
  return { statusCode: res.status, body: data }
}

function assertOk(step, res, expect = 200) {
  if (res.statusCode !== expect) throw new Error(`HTTP ${res.statusCode}（期望 ${expect}）: ${JSON.stringify(res.body).slice(0, 300)}`)
  return res.body
}

// 1. 令牌交换换取浏览器会话 cookie（隔离 profile 走令牌；desktop 本机实例免鉴权时传 token=local）
const localMode = tokenArg === 'local'
let cookie = ''
if (!localMode) {
  await record('auth: /connect 令牌交换', async () => {
    const res = await fetch(`${base}/connect?token=${encodeURIComponent(tokenArg)}`, { redirect: 'manual' })
    if (res.status !== 302) throw new Error(`令牌交换失败 HTTP ${res.status}`)
    const setCookie = res.headers.get('set-cookie') || ''
    cookie = setCookie.split(';')[0]
    if (!cookie) throw new Error('未取得会话 cookie')
    return { exchanged: true }
  })
} else {
  await record('auth: 本机实例免令牌访问（desktop 内部端口）', async () => {
    const res = await fetch(`${base}/api/workbench/capabilities`)
    if (res.status !== 200) throw new Error(`本机访问失败 HTTP ${res.status}`)
    return { exchanged: false, localMode: true }
  })
}

const H = { cookie: () => ({ cookie }) }
await record('workbench: GET /api/workbench/projects（种子项目）', async () => {
  const res = await fetch(`${base}/api/workbench/projects`, { headers: H.cookie() })
  const data = assertOk('projects', { statusCode: res.status, body: await res.json().catch(() => null) })
  if (!Array.isArray(data) || data.length === 0) throw new Error('种子项目缺失')
  const p = data[0]
  if (!p.id || !p.rootPath || !p.title) throw new Error('项目字段不完整')
  return { count: data.length, firstProject: p }
})

await record('workbench: GET /api/workbench/tasks（种子任务）', async () => {
  const res = await fetch(`${base}/api/workbench/tasks`, { headers: H.cookie() })
  const data = assertOk('tasks', { statusCode: res.status, body: await res.json().catch(() => null) })
  if (!Array.isArray(data) || data.length < 2) throw new Error('种子任务数量异常')
  return { count: data.length, statuses: data.map((t) => t.statusCode) }
})

// WorkBuddy 文本桥接已按用户决定移除（0.1.2）：文本生成只有宿主会话一条通路。
let hostBridgeAvailable = false
await record('workbench: GET /api/workbench/capabilities（诚实能力披露）', async () => {
  const res = await fetch(`${base}/api/workbench/capabilities`, { headers: H.cookie() })
  const data = assertOk('capabilities', { statusCode: res.status, body: await res.json().catch(() => null) })
  try {
    const diagRes = await fetch(base + '/api/workbench/diagnostics/host-session', { headers: H.cookie() })
    if (diagRes.status === 200) hostBridgeAvailable = (await diagRes.json()).available === true
  } catch {}
  if (data.executionBackend === 'host-session-controller') {
    if (!hostBridgeAvailable) throw new Error('披露 host-session-controller 但宿主桥接探测不可用（虚报）')
    if (data.capabilities?.textGeneration !== true) throw new Error('宿主桥接可用时 textGeneration 必须为 true')
  } else if (data.executionBackend === 'standalone-local') {
    if (hostBridgeAvailable) throw new Error('宿主桥接可用却披露 standalone-local（失实）')
    if (data.capabilities?.textGeneration !== false) throw new Error('无宿主桥接时 textGeneration 必须如实为 false')
    if ('workbuddy-bridge' in data) throw new Error('已移除的 workbuddy-bridge 后端不得再出现')
  } else {
    throw new Error(`执行后端披露异常: ${data.executionBackend}`)
  }
  return data
})

await record('workbench: GET /api/workbench/control/snapshot（控制条快照）', async () => {
  const res = await fetch(`${base}/api/workbench/control/snapshot`, { headers: H.cookie() })
  const data = assertOk('snapshot', { statusCode: res.status, body: await res.json().catch(() => null) })
  return data
})

await record('workbench: POST /api/workbench/chat/send（主助理降级路径）', async () => {
  const res = await fetch(`${base}/api/workbench/chat/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ text: '你好，请介绍当前工作台状态' }),
  })
  const data = assertOk('chat', { statusCode: res.status, body: await res.json().catch(() => null) })
  if (!data.reply?.text) throw new Error('主助理回复缺失')
  return { replyPreview: String(data.reply.text).slice(0, 120) }
})

let createdTaskId = ''
await record('workbench: POST /api/workbench/tasks（真实建卡）', async () => {
  const res = await fetch(`${base}/api/workbench/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      projectId: 'proj-default',
      title: '真实宿主验证卡',
      goal: '在真实 DSH 宿主中验证任务创建与执行链路',
      acceptance: 'Run 产生诚实结果且任务状态正确流转',
    }),
  })
  const data = assertOk('create-task', { statusCode: res.status, body: await res.json().catch(() => null) })
  createdTaskId = data.id
  if (!createdTaskId) throw new Error('建卡未返回 ID')
  return { id: createdTaskId, statusCode: data.statusCode }
})

await record('workbench: POST /api/workbench/runs/start + 诚实失败路径', async () => {
  const res = await fetch(`${base}/api/workbench/runs/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ taskId: createdTaskId, clientRequestId: `host-verify-${Date.now()}` }),
  })
  const run = assertOk('start-run', { statusCode: res.status, body: await res.json().catch(() => null) })
  if (!run.id) throw new Error('Run 未受理')
  // 快照 items 只含活跃/未决/排队 run，终态 run 会移出；以任务卡流转为收敛信号。
  // Worker 交付依赖宿主 Agent 执行器（T-002 宿主会话化前，iso 环境无 agentRunner
  // 且文本桥接已移除）→ 必须诚实 failed（任务 blocked），绝不得伪造完成。
  let taskStatus = ''
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500))
    const tasksRes = await fetch(`${base}/api/workbench/tasks`, { headers: H.cookie() })
    const tasks = await tasksRes.json().catch(() => [])
    const task = (Array.isArray(tasks) ? tasks : []).find((t) => t.id === createdTaskId)
    taskStatus = task?.statusCode ?? ''
    if (['blocked', 'failed', 'review', 'done'].includes(taskStatus)) break
  }
  if (!['blocked', 'review', 'done'].includes(taskStatus)) {
    throw new Error(`任务必须收敛为诚实终态（blocked/review/done），实测: ${taskStatus || '未流转'}`)
  }
  return { runId: run.id, taskStatus, hostBridgeAvailable }
})

if (!localMode) {
  await record('client: dsh-table client.js 经宿主模块名册正确服务', async () => {
  // 浏览器 cookie（根路径 ?token= 交换）→ 首页 __DSH_BOOT__ 名册 → 按组合 URL 拉取模块
  const res = await fetch(`${base}/?token=${encodeURIComponent(tokenArg)}`, { redirect: 'manual' })
  const setCookie = res.headers.get('set-cookie') || ''
  const browserCookie = setCookie.split(';')[0]
  if (!browserCookie) throw new Error('浏览器 cookie 未取得')
  const indexRes = await fetch(`${base}/`, { headers: { cookie: browserCookie } })
  const index = await indexRes.text()
  const comboMatch = index.match(/plugins\/\?\?[^"']*dsh-table\/client\.js[^"']*/)
  if (!comboMatch) throw new Error('引导名册中缺少 dsh-table client 模块')
  const comboPath = `/${comboMatch[0].replace(/&amp;/g, '&')}`
  const clientRes = await fetch(`${base}${comboPath}`, { headers: { cookie: browserCookie } })
  if (clientRes.status !== 200) throw new Error(`client.js HTTP ${clientRes.status}`)
  const text = await clientRes.text()
  if (!text.includes('__ModuleLoader__')) throw new Error('client.js 不是 DSH ModuleLoader 封装格式')
  if (/(^|[;{\n])\s*import\s+[{"']/.test(text.slice(0, 5000))) {
    throw new Error('client.js 含未编译 import 语句（会导致与 dsh-remoteconnect 同型的 web boot 崩溃）')
  }
  return { bytes: text.length, comboPath: comboPath.slice(0, 80) }
  })
}

await record('workbench: GET /api/workbench/events（Outbox 事件）', async () => {
  const res = await fetch(`${base}/api/workbench/events?after=0`, { headers: H.cookie() })
  const data = assertOk('events', { statusCode: res.status, body: await res.json().catch(() => null) })
  const list = Array.isArray(data) ? data : data?.events ?? []
  if (list.length === 0) throw new Error('Outbox 无事件（建卡/Run 应产生事件）')
  return { count: list.length, kinds: [...new Set(list.map((e) => e.kind ?? e.type))].slice(0, 6) }
})

// 12. 主入口自动建卡并派发：用户一句明确工作请求即可开工，无需先去任务板手工建卡
const autoRequestText = `帮我整理一份真实宿主回归要点清单，覆盖建卡与回流（${new Date().toISOString().slice(11, 19)}）`
// 同一 profile 会累积历史验证数据；以本次唯一时间戳作为断言锚点，避免旧结论干扰计数
const stamp = autoRequestText.match(/（[^）]+）$/)?.[0] ?? autoRequestText
let autoTaskId = ''
await record('主入口: 明确工作请求自动建卡并派发后台执行', async () => {
  const res = await fetch(`${base}/api/workbench/chat/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ text: autoRequestText }),
  })
  const data = assertOk('chat-auto-card', { statusCode: res.status, body: await res.json().catch(() => null) })
  if (!data.task?.id) throw new Error('明确工作请求未自动建卡')
  autoTaskId = data.task.id
  if (!Array.isArray(data.runs) || data.runs.length === 0) throw new Error('自动建卡后未走调度链路派发（runs 为空）')
  if (data.task.projectId !== 'proj-default') throw new Error('自动建卡未落在既有项目下')
  return { taskId: autoTaskId, statusCode: data.task.statusCode, runs: data.runs.length, reply: String(data.reply?.text ?? '').slice(0, 120) }
})

// 13. 后台成果/卡点自动回流主入口：用户不追问也应看到结论，且同一 Run 只回流一次
await record('主入口: 后台执行结束后结果自动回流对话（严格一次）', async () => {
  let taskStatus = ''
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 500))
    const tasksRes = await fetch(`${base}/api/workbench/tasks`, { headers: H.cookie() })
    const tasks = await tasksRes.json().catch(() => [])
    const task = (Array.isArray(tasks) ? tasks : []).find((t) => t.id === autoTaskId)
    taskStatus = task?.statusCode ?? ''
    if (['blocked', 'failed', 'review', 'done'].includes(taskStatus)) break
  }
  if (!['blocked', 'failed', 'review', 'done'].includes(taskStatus)) {
    throw new Error(`自动派发的任务未在 60s 内收敛，实测: ${taskStatus || '未流转'}`)
  }
  const msgsRes = await fetch(`${base}/api/workbench/chat/messages`, { headers: H.cookie() })
  const msgs = await msgsRes.json().catch(() => [])
  const list = Array.isArray(msgs) ? msgs : msgs?.messages ?? []
  const delivered = list.filter(
    (m) =>
      m.sender === 'assistant' &&
      /^(✅ 已完成|⚠️ 执行结束但未达验收|⚠️ 未完成|⏹ 已停止)/.test(String(m.text)) &&
      String(m.text).includes(stamp),
  )
  if (delivered.length !== 1) throw new Error(`结果回流消息必须严格一次，实测 ${delivered.length} 条`)
  const text = String(delivered[0].text)
  if (!text.includes('卡片状态：')) throw new Error('回流消息未披露卡片状态')
  // 诚实性：卡片阻塞时不得声称顺利完成
  if (taskStatus === 'blocked' && !text.startsWith('⚠️')) {
    throw new Error(`卡片为 blocked 时回流消息不得声称完成: ${text.slice(0, 60)}`)
  }
  return { taskStatus, delivered: 1, preview: text.slice(0, 140) }
})

// 14. 重复请求复用既有卡；疑问/讨论不得误建卡（避免批量生产活跃卡）
await record('主入口: 重复请求复用同卡、疑问与讨论不误建卡', async () => {
  const countTasks = async () => {
    const r = await fetch(`${base}/api/workbench/tasks`, { headers: H.cookie() })
    const d = await r.json().catch(() => [])
    return Array.isArray(d) ? d.length : 0
  }
  const before = await countTasks()

  const again = await fetch(`${base}/api/workbench/chat/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ text: autoRequestText }),
  })
  const againData = await again.json().catch(() => null)
  if (againData?.task?.id !== autoTaskId) throw new Error('重复请求未复用既有任务卡')
  if (!String(againData.reply?.text ?? '').includes('既有任务卡')) throw new Error('重复请求应如实说明复用既有卡')

  const question = await fetch(`${base}/api/workbench/chat/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ text: '帮我整理一下这份材料可以吗？' }),
  })
  const questionData = await question.json().catch(() => null)
  if (questionData?.task) throw new Error('疑问句被误判为工作指令并建卡')

  const after = await countTasks()
  if (after !== before) throw new Error(`闲聊/疑问导致新增任务卡（${before} → ${after}）`)
  return { reusedTaskId: autoTaskId, taskCountUnchanged: after }
})

const summary = {
  product: 'dsh-table',
  evidenceLayer: 'HOST (isolated profile, real dsh runtime 0.2.1-rc.2)',
  generatedAt: new Date().toISOString(),
  profile: 'dsh-table-iso',
  endpoint: `http://127.0.0.1:${port}`,
  cases: results,
  pass: results.filter((r) => r.status === 'PASS').length,
  fail: results.filter((r) => r.status === 'FAIL').length,
}
writeFileSync(outPath, JSON.stringify(summary, null, 2))
console.log(`\nSUMMARY: ${summary.pass} PASS / ${summary.fail} FAIL -> ${outPath}`)
process.exit(summary.fail > 0 ? 1 : 0)
