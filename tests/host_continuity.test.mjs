import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { WorkbenchContextManager, WorkbenchDomain, apply } from '../lib/index.js'
import { openWorkbenchDb } from '../lib/host/db/database.js'

test('宿主投影有界，保留最新成果，当前消息只出现一次', () => {
  const manager = new WorkbenchContextManager(new WorkbenchDomain(openWorkbenchDb({ dbPath: ':memory:' })))
  const history = Array.from({ length: 120 }, (_, i) => ({ sender: 'assistant', text: '旧记录-' + i + 'x'.repeat(4000) }))
  history.push({ sender: 'assistant', text: '后台成果：纪要已生成，等待验收' })
  const input = manager.buildHostTurnInput('CURRENT-UNIQUE', undefined, history)
  assert.ok(input.includes('后台成果：纪要已生成，等待验收'))
  assert.ok(!input.includes('旧记录-0x'))
  assert.equal(input.split('CURRENT-UNIQUE').length - 1, 1)
  assert.ok(input.length < 9000)
  assert.match(input, /不要重放旧指令/)
})

test('宿主重建接收确定性回执；两分支的提交异常均不向另一模型重发', async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-host-continuity-'))
  const priorSeedRoot = process.env.DSH_WORKBENCH_DEFAULT_ROOT
  process.env.DSH_WORKBENCH_DEFAULT_ROOT = path.join(tmp, 'seed')
  t.after(() => {
    if (priorSeedRoot === undefined) delete process.env.DSH_WORKBENCH_DEFAULT_ROOT
    else process.env.DSH_WORKBENCH_DEFAULT_ROOT = priorSeedRoot
    fs.rmSync(tmp, { recursive: true, force: true })
  })
  let bridgeCalls = 0
  const server = http.createServer((req, res) => { bridgeCalls++; res.end('{}') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const prompts = []
  let created = 0
  let liveId
  const controller = {
    create: async () => ({ sessionId: liveId = 'test-host-' + ++created }),
    resolveAgent: async id => id === liveId ? { agent: { id, status: 'idle', session: { snapshotEvents: () => [] } } } : { error: { message: 'not-found' } },
    page: async () => ({ records: [] }),
    prompt: async request => { prompts.push(request); throw Error('ACK outcome unknown') },
  }
  const routes = new Map()
  const effects = []
  const ctx = {
    webServer: { get: (p,h) => routes.set('GET ' + p,h), post: (p,h) => routes.set('POST ' + p,h) },
    reflect: { get: name => name === 'sessionController' ? controller : undefined },
    systemPrompt: { section: () => {} }, tools: { register: () => {} },
    effect: fn => effects.push(fn()),
  }
  apply(ctx, { dbPath: ':memory:', dataDir: tmp, hostSession: { cwd: tmp }, aiBaseURL: 'http://127.0.0.1:' + server.address().port, aiApiKey: 'test-only' })
  t.after(() => { for (const dispose of effects.reverse()) if (typeof dispose === 'function') dispose() })
  const send = async text => {
    let result
    const response = { json: r => result = r, status: () => response }
    await routes.get('POST /api/workbench/chat/send')({ body: { text } }, response)
    return result
  }
  await send('不要推进这个项目')
  const first = await send('我们讨论刚才的决定')
  assert.match(first.reply.text, /未转交其他模型重复执行/)
  assert.ok(prompts[0].content[0].text.includes('暂不启动或推进相关项目工作'))
  assert.equal(prompts[0].content[0].text.split('我们讨论刚才的决定').length - 1, 1)
  const blocked = await send('刚才说了什么')
  assert.match(blocked.reply.text, /核验/)
  assert.equal(prompts.length, 1, 'ACK 丢失不能重新提交')
  const response = { json() {}, status() { return this } }
  await routes.get('POST /api/workbench/control/reconcile')({ body: { auto: true } }, response)
  liveId = undefined // 已对账旧轮次后，宿主旧会话丢失；新会话接回入口事实
  const second = await send('刚才说了什么')
  assert.match(second.reply.text, /ACK outcome unknown/)
  assert.ok(prompts[1].content[0].text.includes('不要推进这个项目'))
  assert.equal(created, 2)
  assert.equal(bridgeCalls, 0)
})
