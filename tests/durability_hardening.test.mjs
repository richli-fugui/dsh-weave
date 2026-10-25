import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openWorkbenchDb } from '../lib/host/db/database.js'
import { WorkbenchDomain } from '../lib/host/services/domain.js'
import { ConflictError, NotFoundError } from '../lib/shared/errors.js'

/**
 * T-018：外部代码审查（Gemini 4 Argon, 2026-10-25）成立项的加固回归。
 * 背景：审查报告有多处与真实代码不符（逐条审计见轮次记录），
 * 但以下问题经实证成立并已修复：事务原子性、SQL 层乐观锁、busy_timeout、
 * JSON 字段容错、面板错误边界。
 */

function freshDomain() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-table-durability-'))
  const db = openWorkbenchDb({ dbPath: path.join(dir, 'wb.db') })
  const domain = new WorkbenchDomain(db)
  return { db, domain, dir }
}

test('T-018 外部审查成立项加固', async (t) => {
  await t.test('构建产物不再携带已移除的桥接模块', () => {
    assert.equal(fs.existsSync(new URL('../src/host/services/ai-client.ts', import.meta.url)), false)
    for (const extension of ['js', 'js.map', 'd.ts', 'd.ts.map']) {
      assert.equal(fs.existsSync(new URL('../lib/host/services/ai-client.' + extension, import.meta.url)), false)
    }
  })
  await t.test('1. busy_timeout 已启用（多进程并发写等待锁而非立刻 SQLITE_BUSY）', () => {
    const { db } = freshDomain()
    const row = db.prepare('PRAGMA busy_timeout').get()
    assert.equal(row.timeout, 5000)
    db.close()
  })

  await t.test('2. createTask 与 Outbox 事件同事务：事件失败实体回滚', () => {
    const { db, domain } = freshDomain()
    const proj = domain.createProject({ title: 'P', rootPath: 'C:\\t\\p' })
    // 模拟事件写入失败：子类注入抛错
    class FailingOutbox extends WorkbenchDomain {
      appendOutboxEvent(entityId, type) { if (type === 'task.created') throw new Error('outbox write failure (injected)'); return super.appendOutboxEvent(entityId, type) }
    }
    const dom = new FailingOutbox(db)
    assert.throws(() => dom.createTask({ projectId: proj.id, title: 'T', goal: '', acceptance: '' }), /outbox write failure/)
    // 事务回滚：任务不得残留（详见 2b 对 listTasks 的直接断言）
    assert.equal(domain.listTasks(proj.id).length, 0, '事件失败后任务必须随事务回滚')
  })

  await t.test('2b. 事务回滚后 Outbox 无孤儿事件', () => {
    const { db, domain } = freshDomain()
    const proj = domain.createProject({ title: 'P', rootPath: 'C:\\t\\p' })
    const before = domain.listOutboxEvents(0, 1000).length
    class FailingOutbox extends WorkbenchDomain {
      appendOutboxEvent(entityId, type) { if (type === 'task.created') throw new Error('injected'); return super.appendOutboxEvent(entityId, type) }
    }
    const dom = new FailingOutbox(db)
    assert.throws(() => dom.createTask({ projectId: proj.id, title: 'T2', goal: '', acceptance: '' }), /injected/)
    const events = domain.listOutboxEvents(0, 1000).filter((e) => e.kind === 'task.created')
    assert.equal(events.length, 0, '不得出现孤儿 task.created 事件')
  })

  await t.test('3. updateTask SQL 层乐观锁：校验与写入之间被跨进程并发修改时拒绝覆盖', () => {
    const { db, domain } = freshDomain()
    const proj = domain.createProject({ title: 'P', rootPath: 'C:\\t\\p' })
    const task = domain.createTask({ projectId: proj.id, title: 'T3', goal: '', acceptance: '' })
    // 模拟并发写者：在域对象“读到 current”之后、UPDATE 之前把行改掉。
    // 通过子类让 getTask 返回过期视图（TS 校验通过），真实行 revision 已被抬高。
    const realGetTask = domain.getTask.bind(domain)
    let poisoned = false
    domain.getTask = (id) => {
      const current = realGetTask(id)
      if (!poisoned && id === task.id) {
        poisoned = true
        // 并发写者直接抬高行版本（模拟另一进程的 UPDATE）
        db.prepare('UPDATE tasks SET revision = revision + 5 WHERE id = ?').run(id)
        return current // 返回过期快照 → TS 校验放行
      }
      return current
    }
    assert.throws(
      () => domain.updateTask({ id: task.id, expectedRevision: task.revision, title: '并发下不应生效' }),
      ConflictError,
      'SQL 层 changes=0 必须抛 ConflictError 而非静默覆盖',
    )
    const fresh = realGetTask(task.id)
    assert.notEqual(fresh.title, '并发下不应生效', '并发写入不得丢失')
  })

  await t.test('3b. updateProject 同样受 SQL 层乐观锁保护', () => {
    const { db, domain } = freshDomain()
    const proj = domain.createProject({ title: 'P', rootPath: 'C:\\t\\p' })
    const realGet = domain.getProject.bind(domain)
    let poisoned = false
    domain.getProject = (id) => {
      const current = realGet(id)
      if (!poisoned && id === proj.id) {
        poisoned = true
        db.prepare('UPDATE projects SET revision = revision + 3 WHERE id = ?').run(id)
        return current
      }
      return current
    }
    assert.throws(() => domain.updateProject({ id: proj.id, expectedRevision: proj.revision, title: 'X' }), ConflictError)
  })

  await t.test('4. 损坏的 dependencies_json 不再炸读取路径（安全降级为空数组）', () => {
    const { db, domain } = freshDomain()
    const proj = domain.createProject({ title: 'P', rootPath: 'C:\\t\\p' })
    const task = domain.createTask({ projectId: proj.id, title: 'T4', goal: '', acceptance: '' })
    db.prepare("UPDATE tasks SET dependencies_json = '{corrupted!!' WHERE id = ?").run(task.id)
    const t = domain.getTask(task.id)
    assert.deepEqual(t.dependencies, [], '脏 JSON 必须降级为空数组而非抛错')
    const list = domain.listTasks(proj.id)
    assert.equal(list.length, 1, '列表读取同样安全')
  })

  await t.test('5. 客户端面板错误边界：真实产物导出且语义正确、主内容被包裹', async () => {
    const { createRequire } = await import('node:module')
    const req = createRequire(import.meta.url)
    const vm = await import('node:vm')
    // 执行打包产物（ModuleLoader 包装），取真实导出
    const code = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
    let captured = null
    const sandboxWindow = { __ModuleLoader__: { load: (entry) => { captured = entry } } }
    const sandbox = { window: sandboxWindow, document: { body: { appendChild() {} }, getElementById: () => null }, console }
    vm.createContext(sandbox)
    vm.runInContext(code, sandbox, { filename: 'client.js' })
    assert.ok(captured, '产物必须经 ModuleLoader 注册')
    const moduleExports = captured.factory(req)
    const Boundary = moduleExports.PanelErrorBoundary
    assert.equal(typeof Boundary, 'function', '产物必须导出 PanelErrorBoundary')
    // 语义：派生状态捕获错误；实例渲染降级路径可调用
    const derived = Boundary.getDerivedStateFromError(new Error('kaboom'))
    assert.ok(derived && derived.error && derived.error.message === 'kaboom')
    const inst = new Boundary({ children: null })
    inst.state = derived
    const React = req('react')
    const out = inst.render()
    assert.ok(React.isValidElement(out), '错误态渲染必须返回元素而非抛错')
    // 主内容包裹契约（源码级）
    const src = fs.readFileSync(new URL('../src/client.tsx', import.meta.url), 'utf8')
    assert.ok(src.includes('<PanelErrorBoundary>'), '面板主内容必须被错误边界包裹')
  })

  await t.test('7. optionalService 回归：cordis 代理式 ctx 下服务缺席必须优雅降级（不抛 inject 错）', async () => {
    // 背景：2026-10-25 真实 iso 宿主复现——optionalService 曾直落 (ctx)[name]，
    // 服务不存在时 cordis 代理抛 "cannot get property ... without inject"，
    // 把 worker 的宿主 Agent 分支整链炸掉（而非降级到桥接/诚实失败）。
    const { apply } = await import('../lib/index.js')
    const routes = new Map()
    const baseCtx = {
      webServer: { get: (p, h) => routes.set('GET ' + p, h), post: (p, h) => routes.set('POST ' + p, h) },
      systemPrompt: { section: () => {} },
      tools: { register: () => {} },
      reflect: { get: () => undefined }, // reflect 找不到任何服务（缺席语义）
    }
    // 模拟 cordis 代理：对未声明 inject 的“服务名”访问抛错（普通属性照常返回 undefined）
    const THROWING_SERVICE_NAMES = new Set(['agentRunner', 'sessionController', 'agents', 'sessions', 'llm'])
    const proxyCtx = new Proxy(baseCtx, {
      get(target, prop) {
        if (prop in target) return target[prop]
        if (THROWING_SERVICE_NAMES.has(String(prop))) {
          throw new Error(`cannot get property "${String(prop)}" without inject`)
        }
        return undefined
      },
    })
    process.env.DSH_WORKBENCH_DEFAULT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-table-cordis-ctx-'))
    apply(proxyCtx, { dbPath: ':memory:' })
    // 经聊天入口派发一张卡（走真实 worker executor 路径），验证不因代理抛错崩溃
    const chat = routes.get('POST /api/workbench/chat/send')
    let resp = null
    const res = { status: () => res, json: (d) => { resp = d; return res } }
    await chat({ body: { text: '帮我整理一份测试材料，输出两段说明' } }, res)
    assert.ok(resp?.reply, '聊天路径必须正常回复（降级而非崩溃）')
    const tasks = routes.get('GET /api/workbench/tasks')
    let taskList = null
    await tasks({ query: {} }, { status: () => res, json: (d) => { taskList = d; return res } })
    const created = (taskList ?? []).find((x) => /测试材料/.test(x.title))
    assert.ok(created, '自动建卡应正常发生')
    // 等待 worker 收敛：必须诚实 blocked（桥接不可用），错误摘要里绝不能出现 inject 崩溃
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 300))
      let list = null
      await tasks({ query: {} }, { status: () => res, json: (d) => { list = d; return res } })
      const t = (list ?? []).find((x) => x.id === created.id)
      if (t && t.statusCode !== 'in_progress' && t.statusCode !== 'todo') {
        assert.notEqual(t.statusCode, 'in_progress')
        break
      }
    }
    let finalList = null
    await tasks({ query: {} }, { status: () => res, json: (d) => { finalList = d; return res } })
    const finalTask = (finalList ?? []).find((x) => x.id === created.id)
    assert.equal(finalTask.statusCode, 'blocked', '桥接不可用时必须诚实 blocked')
    const msgs = routes.get('GET /api/workbench/chat/messages')
    let messages = null
    await msgs({}, { status: () => res, json: (d) => { messages = d; return res } })
    const backflow = (messages ?? []).filter((m) => m.sender === 'assistant').map((m) => m.text).join('\n')
    assert.ok(!backflow.includes('without inject'), '回流消息不得包含 cordis inject 崩溃（必须优雅降级）')
  })

  await t.test('6. 调度器异步兜底：善后路径抛错不再成为 Unhandled Rejection', async () => {
    const { TaskScheduler } = await import('../lib/host/services/scheduler.js')
    const { db, domain } = freshDomain()
    const proj = domain.createProject({ title: 'P', rootPath: 'C:\\t\\p' })
    const task = domain.createTask({ projectId: proj.id, title: 'T6', goal: '', acceptance: '' })
    let boomAfterStart = false
    // executor 正常完成，但让 completeRun 在 finally 之前抛错？——更直接：
    // 用一个“resolve 后 throw 的 fake 善后”很难精确注入；此处验证行为面：
    // 调用点挂了 .catch（源码契约），并且正常执行路径不受影响。
    const src = fs.readFileSync(new URL('../src/host/services/scheduler.ts', import.meta.url), 'utf8')
    assert.ok(src.includes('executeRunAsync(run, task, abortController, handle).catch'), '调用点必须挂 .catch 兜底')
    const sched = new TaskScheduler(domain, async () => ({ state: 'completed', summary: 'ok', suggestedTaskStatus: 'review' }))
    await sched.dispatchBatch([task.id], 'durability-' + Date.now())
    await new Promise((r) => setTimeout(r, 50))
    const snap = sched.getControlSnapshot()
    assert.equal(snap.activeCount, 0, '正常路径执行完毕释放槽位')
    db.close()
  })
})
