// Explicit opt-in. Three short synthetic turns; no task/file actions or raw session export.
// Raw user input mode: test harness does NOT pre-assemble context; the deployed server
// assembles multi-turn context from its SQLite database via WorkbenchContextManager.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

if (process.env.RUN_REAL_HOST_CONTINUITY !== 'true') throw Error('Set RUN_REAL_HOST_CONTINUITY=true to authorize three real model turns')
const port = Number(process.argv[2])
const output = process.argv[3]
if (!Number.isInteger(port) || !output) throw Error('Usage: <port> <private-output.json>')
const base = 'http://127.0.0.1:' + port + '/api/workbench'
const get = async route => { const r = await fetch(base + route); if (!r.ok) throw Error('HTTP ' + r.status); return r.json() }
const snapshot = await get('/control/snapshot')
const diag = await get('/diagnostics/host-session')
if (!diag.available || diag.agentStatus !== 'idle' || snapshot.activeCount || snapshot.queuedCount || snapshot.awaitingCount || snapshot.unknownCount) throw Error('Host must be available and idle')

const marker = 'BLUE-' + Date.now().toString(36).toUpperCase()
const turns = [
  '这是一段合成会议背景：活动代号 ' + marker + '，主题为林间阅读，输出形式约定为三条中文短句，状态为待办暂未授权执行。只回复收到。',
  '补充刚才的约定：语气温和，日期为周五。只回复收到。',
  '刚才那个活动的代号、主题、输出形式、语气和日期分别是什么？该活动当前是否已执行？请在一段话里回答。',
]
const report = {
  evidenceLayer: 'MODEL+HOST',
  generatedAt: new Date().toISOString(),
  scope: 'Raw user text sent to /api/workbench/chat/send on deployed 0.1.1; server assembles context from database without test harness pre-assembly. No desktop UI interaction.',
  model: diag.modelSelection,
  cases: []
}
let sessionId
try {
  for (let i = 0; i < turns.length; i++) {
    const rawInput = turns[i]
    const response = await fetch(base + '/chat/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: rawInput }),
      signal: AbortSignal.timeout(210000)
    })
    if (!response.ok) throw Error('HTTP ' + response.status)
    const data = await response.json()
    if (data.hostSession?.status !== 'replied') throw Error('Host did not produce a settled reply: ' + (data.hostSession?.status || 'no host result'))
    if (sessionId && sessionId !== data.hostSession.sessionId) throw Error('Session changed during continuity check')
    sessionId = data.hostSession.sessionId
    const reply = String(data.reply?.text || '')
    const checks = i === 2 ? {
      marker: reply.includes(marker),
      topic: reply.includes('林间阅读'),
      format: /三|3/.test(reply),
      tone: reply.includes('温和'),
      date: reply.includes('周五'),
      noExecution: /未.*(?:执行|启动)|没有.*(?:执行|启动)/.test(reply),
    } : { nonempty: !!reply }
    report.cases.push({ turn: i + 1, status: Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL', checks })
    console.log('Turn ' + (i + 1) + ': ' + report.cases.at(-1).status)
  }
  report.sessionFingerprint = createHash('sha256').update(sessionId).digest('hex').slice(0, 16)
} catch (error) {
  report.failure = String(error.message).replace(/session-[a-f0-9-]+/gi, '<SESSION_ID>')
  process.exitCode = 1
} finally {
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true })
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
  if (report.cases.some(c => c.status === 'FAIL')) process.exitCode = 1
}
