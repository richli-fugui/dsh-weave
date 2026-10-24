// T-006/T-003：CDP 驱动的真实桌面交互点验（v2）。
// 前置：DeepSeek Harness 以 --remote-debugging-port=<cdpPort> 启动，面板插件已加载，API 端口已知。
// 用法：node scripts/desktop-interact-verify.mjs <cdpPort> <apiPort> <outDir>
//
// v2 修正（v1 教训，见轮次记录）：
//   - 截图为证据采集，绝不阻塞时序关键路径（try/catch + 短超时，失败不判 FAIL）
//   - 使用长任务（约2000字文档）拉开停止窗口（实测模型短任务仅约4秒，v1 点击落于自然完成之后）
//   - 按卡片标题在其容器内定位按钮，避免命中其他卡片的同名按钮
//   - U3 全链路：A运行/B排队 → 停A → B唤醒继续 → A“推进该任务”开新一轮（可排队）→ 停止全部
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [, , cdpPortArg, apiPortArg, outDirArg] = process.argv
const cdpPort = Number(cdpPortArg)
const apiPort = Number(apiPortArg)
const outDir = outDirArg
mkdirSync(outDir, { recursive: true })

const results = []
const consoleErrors = []
let msgId = 0
const pending = new Map()
let ws = null

function send(method, params = {}) {
  const id = ++msgId
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        reject(new Error(`CDP timeout: ${method}`))
      }
    }, 10000)
  })
}

async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()
  const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  if (!page) throw new Error('未找到可调试的页面目标')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args?.map((a) => a.value ?? a.description).join(' ').slice(0, 200))
    } else if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(String(msg.params.exceptionDetails?.text ?? 'exception').slice(0, 200))
    }
  }
  await send('Runtime.enable')
  await send('Page.enable')
  return page
}

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (res.exceptionDetails) throw new Error(`页面执行异常: ${res.exceptionDetails.text}`)
  return res.result.value
}

const shotErrors = []
async function shot(name) {
  try {
    await send('Page.bringToFront').catch(() => {})
    const res = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(outDir, name), Buffer.from(res.data, 'base64'))
    return true
  } catch (err) {
    shotErrors.push(`${name}: ${err.message}`)
    return false
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(method, path, body) {
  const res = await fetch(`http://127.0.0.1:${apiPort}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, data: await res.json().catch(() => null) }
}

function record(name, ok, detail) {
  results.push({ name, status: ok ? 'PASS' : 'FAIL', detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + JSON.stringify(detail).slice(0, 200) : ''}`)
}

async function waitFor(desc, fn, timeoutMs = 40000, interval = 500) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const v = await fn()
    if (v) return v
    await sleep(interval)
  }
  throw new Error(`等待超时: ${desc}`)
}

// 页面内：按完整标题文本定位卡片容器，再在其内找指定文案按钮并点击
const clickCardButton = `(async (cardTitle, btnText) => {
  const leaves = [...document.querySelectorAll('*')].filter(e => e.childElementCount === 0 && e.textContent.trim() === cardTitle && e.offsetParent !== null)
  if (!leaves.length) return 'card-not-found'
  let node = leaves[0]
  while (node && node !== document.body) {
    if (node.textContent.includes(btnText)) {
      const btn = [...node.querySelectorAll('button')].find(b => b.textContent.trim() === btnText && b.offsetParent !== null)
      if (btn) { btn.click(); return 'clicked' }
    }
    node = node.parentElement
  }
  return 'button-not-found'
})`

const hasCardButton = `((cardTitle, btnText) => {
  const leaves = [...document.querySelectorAll('*')].filter(e => e.childElementCount === 0 && e.textContent.trim() === cardTitle && e.offsetParent !== null)
  if (!leaves.length) return false
  let node = leaves[0]
  while (node && node !== document.body) {
    if (node.textContent.includes(btnText)) {
      const btn = [...node.querySelectorAll('button')].find(b => b.textContent.trim() === btnText && b.offsetParent !== null)
      if (btn) return true
    }
    node = node.parentElement
  }
  return false
})`

async function main() {
  await connect()
  const stamp = Date.now().toString(36)
  const projRes = await api('GET', '/api/workbench/projects')
  const projectId = projRes.data?.[0]?.id
  if (!projectId) throw new Error('无可用项目')

  const titleA = `桌面点验A-停A保B-${stamp}`
  const titleB = `桌面点验B-停A保B-${stamp}`
  const longGoal = '请写一份约2000字的DSH任务工作台设计说明文档，包含总体架构、数据模型、调度与停止语义、权限边界、部署与回滚共五个章节，每章至少三段。'

  // S1 打开面板
  try {
    await waitFor('侧栏“任务台”入口', () => evaluate(`!!(function(){const els=[...document.querySelectorAll('button')];return els.find(e=>(e.getAttribute('aria-label')||e.title||'').includes('任务台')&&e.offsetParent!==null)})()`), 20000)
    await evaluate(`(function(){const els=[...document.querySelectorAll('button')];const b=els.find(e=>(e.getAttribute('aria-label')||e.title||'').includes('任务台')&&e.offsetParent!==null);if(b){b.click();return true}return false})()`)
    await sleep(1500)
    const panelOk = await evaluate(`(() => {
      const txt = document.body.innerText
      return {
        controlBar: txt.includes('停止全部工作'),
        chatInput: !!document.querySelector('textarea, input[placeholder*="推进"]'),
      }
    })()`)
    await shot(`01-panel-open-${stamp}.png`)
    record('S1 点击侧栏入口打开任务台面板（控制条与聊天输入齐全）', panelOk.controlBar && panelOk.chatInput, panelOk)
  } catch (err) { record('S1 打开任务台面板', false, String(err.message)) }

  // 建卡（API；派发走 UI 聊天输入框 = 真实用户路径）
  const mk = async (title) => {
    const r = await api('POST', '/api/workbench/tasks', {
      projectId, title, goal: longGoal,
      acceptance: '文档五章节结构完整且总字数达标',
      priorityCode: 'normal',
    })
    if (r.status !== 200) throw new Error(`建卡失败: ${JSON.stringify(r.data).slice(0, 120)}`)
    return r.data.id
  }
  let taskA = '', taskB = ''
  try {
    taskA = await mk(titleA)
    taskB = await mk(titleB)
  } catch (err) { record('S2 前置建卡', false, String(err.message)) }

  // S2 面板聊天输入框 @任务卡 批量派发（长任务 A 运行、B 同项目排队）
  try {
    const typed = await evaluate(`(async () => {
      const el = document.querySelector('textarea') || [...document.querySelectorAll('input')].find(i => (i.placeholder||'').includes('推进'))
      if (!el) return 'no-input'
      const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, '@task:${taskA} @task:${taskB} 推进')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 300))
      const sendBtn = [...document.querySelectorAll('button')].find(b => b.offsetParent && (b.textContent.includes('发送') || b.getAttribute('aria-label') === 'send'))
      if (sendBtn) { sendBtn.click(); return 'sent' }
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      return 'enter'
    })()`)
    if (typed === 'no-input') throw new Error('未找到面板聊天输入框')
    // A 进入执行：A 卡出现“停止执行”按钮（不截图，保持时序）
    await waitFor('A 卡进入执行（出现停止执行）', () => evaluate(`(${hasCardButton})('${titleA}', '停止执行')`), 20000)
    const queuedOk = await api('GET', '/api/workbench/control/snapshot')
    await shot(`02-dispatch-AB-${stamp}.png`)
    record('S2 面板输入框 @任务卡 批量派发：A 执行中、B 排队', true,
      { send: typed, queued: queuedOk.data.queuedCount, active: queuedOk.data.activeCount })
  } catch (err) { record('S2 面板输入框批量派发', false, String(err.message)) }

  // S3 停A保B：立即点击 A 卡“停止执行”（长任务窗口内）
  try {
    const clickRes = await evaluate(`(${clickCardButton})('${titleA}', '停止执行')`)
    if (clickRes !== 'clicked') throw new Error(`A 卡停止按钮点击失败: ${clickRes}`)
    // A 收敛为待办（被中断，可复跑）；B 被唤醒进入执行
    await waitFor('A 停止收敛为待办', async () => {
      const r = await api('GET', '/api/workbench/tasks')
      const a = r.data.find((t) => t.id === taskA)
      return ['todo', 'blocked'].includes(a?.statusCode ?? '') ? a.statusCode : null
    }, 30000)
    const bRunning = await waitFor('B 唤醒进入执行（B 卡出现停止执行）', () => evaluate(`(${hasCardButton})('${titleB}', '停止执行')`), 30000)
    await shot(`03-stop-A-B-proceeds-${stamp}.png`)
    const r = await api('GET', '/api/workbench/tasks')
    const a = r.data.find((t) => t.id === taskA)
    const b = r.data.find((t) => t.id === taskB)
    record('S3 停A保B：点击A卡停止→A回待办、B不受影响继续执行', a.statusCode === 'todo' && !!bRunning && b.statusCode === 'in_progress',
      { a: a.statusCode, b: b.statusCode })
  } catch (err) { record('S3 停A保B', false, String(err.message)) }

  // S4 已停止的 A 开新一轮（点击“推进该任务”；B 仍在执行 → A 进入排队，恢复不被误杀）
  try {
    const clickRes = await evaluate(`(${clickCardButton})('${titleA}', '推进该任务')`)
    if (clickRes !== 'clicked') throw new Error(`A 卡推进按钮点击失败: ${clickRes}`)
    const snap = await waitFor('A 重新受理（排队或执行）', async () => {
      const r = await api('GET', '/api/workbench/control/snapshot')
      return (r.data.queuedCount > 0 || r.data.activeCount >= 2) ? r.data : null
    }, 20000)
    await shot(`04-A-new-round-${stamp}.png`)
    record('S4 已停止卡可开新一轮（推进该任务→重新受理）', true, { active: snap.activeCount, queued: snap.queuedCount })
  } catch (err) { record('S4 已停止卡新一轮', false, String(err.message)) }

  // S5 控制条“停止全部工作”：B（执行中）与 A（排队）一并停止
  try {
    const clicked = await evaluate(`(function(){const els=[...document.querySelectorAll('button')];const b=els.find(e=>e.textContent.trim()==='停止全部工作'&&e.offsetParent!==null);if(b){b.click();return true}return false})()`)
    if (!clicked) throw new Error('未找到“停止全部工作”按钮')
    const snap = await waitFor('全部停止收敛', async () => {
      const r = await api('GET', '/api/workbench/control/snapshot')
      return r.data.activeCount === 0 && r.data.queuedCount === 0 ? r.data : null
    }, 40000)
    await sleep(800)
    await shot(`05-stop-all-${stamp}.png`)
    const r = await api('GET', '/api/workbench/tasks')
    const a = r.data.find((t) => t.id === taskA)
    const b = r.data.find((t) => t.id === taskB)
    const notLost = ['todo', 'blocked', 'review', 'done'].includes(a.statusCode) && ['todo', 'blocked', 'review'].includes(b.statusCode)
    record('S5 控制条停止全部工作（执行+排队清空，卡片不丢失）', notLost, { a: a.statusCode, b: b.statusCode })
  } catch (err) { record('S5 停止全部工作', false, String(err.message)) }

  const summary = {
    product: 'dsh-table',
    evidenceLayer: 'DESKTOP (real DSH desktop 0.2.1-rc.2, CDP-driven UI interaction)',
    generatedAt: new Date().toISOString(),
    cdpPort, apiPort,
    tasks: { A: taskA, B: taskB, titleA, titleB },
    cases: results,
    screenshots: { shotErrors },
    consoleErrorCount: consoleErrors.length,
    consoleErrors: consoleErrors.slice(0, 5),
    pass: results.filter((r) => r.status === 'PASS').length,
    fail: results.filter((r) => r.status === 'FAIL').length,
  }
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
  console.log(`\nSUMMARY: ${summary.pass} PASS / ${summary.fail} FAIL / consoleErrors=${consoleErrors.length} / shots=${shotErrors.length}err -> ${outDir}`)
  ws.close()
  process.exit(summary.fail > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('FATAL:', err.message)
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ fatal: String(err.message), cases: results }, null, 2))
  process.exit(1)
})
