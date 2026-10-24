// T-014 客户端面板契约测试：
// DSH 客户端要求同一个面板 id 同时注册到 root 作用域的 `main`（keyed slot，承载内容）
// 与 `sidebar.panellist`（图标入口）；只注册图标时点击会抛错并保留当前面板。
// 该测试直接执行打包后的 lib/client.js（ModuleLoader 产物），用真实 react 解析，
// 防止“能构建但桌面点不开”的回归。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const require = createRequire(import.meta.url)

function loadClientFactory() {
  const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  let captured = null
  const window = {
    __ModuleLoader__: {
      load: (entry) => {
        captured = entry
      },
    },
  }
  const sandbox = { window, document: { body: { appendChild() {} }, getElementById: () => null }, console }
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox, { filename: 'client.js' })
  assert.ok(captured, 'client.js 必须通过 window.__ModuleLoader__ 注册自身')
  assert.equal(captured.id, 'dsh-table', '模块 id 必须与包名一致')
  return captured.factory
}

function makeCtx() {
  const registered = []
  const selected = []
  const slots = {
    inject: (name, fn) => {
      fn()
      return () => {}
    },
    register: (meta, component) => {
      registered.push({ meta, component })
      return () => {}
    },
  }
  const layout = {
    selectPanel: (id) => {
      selected.push(id)
    },
  }
  return { ctx: { slots, layout }, registered, selected }
}

test('客户端面板契约：main 与 sidebar.panellist 成对注册，图标点击走 layout.selectPanel', () => {
  const factory = loadClientFactory()
  const exported = factory((spec) => require(spec))

  assert.equal(exported.name, 'workbench')
  assert.deepEqual(Array.from(exported.inject), ['slots', 'layout'])

  const { ctx, registered, selected } = makeCtx()
  const dispose = exported.apply(ctx)
  assert.equal(typeof dispose, 'function', 'apply 必须返回可释放函数')

  const main = registered.find((r) => r.meta?.name === 'main')
  const icon = registered.find((r) => r.meta?.name === 'sidebar.panellist')
  assert.ok(main, '必须注册 main 主面板内容（缺失则点击图标会抛错、面板打不开）')
  assert.equal(main.meta.key, 'workbench', 'main 的 key 必须与面板 id 一致')
  assert.equal(typeof main.component, 'function', 'main 必须提供内容组件')

  assert.ok(icon, '必须注册 sidebar.panellist 图标入口')
  assert.equal(icon.meta.id, 'workbench', '图标 id 必须与 main key 一致')
  assert.equal(typeof icon.meta.label, 'string', '图标必须有可见标签')
  assert.equal(typeof icon.component, 'function', '图标必须提供组件')

  // 图标组件点击后应切换面板，而不是自行叠加覆盖层
  const IconComp = icon.component
  const element = IconComp()
  assert.equal(typeof element?.props?.onClick, 'function', '图标必须可点击')
  element.props.onClick()
  assert.deepEqual(selected, ['workbench'], '图标点击必须调用 layout.selectPanel("workbench")')
})

test('客户端面板契约：缺少 slots/layout 服务时 apply 不抛错（宿主降级安全）', () => {
  const factory = loadClientFactory()
  const exported = factory((spec) => require(spec))
  const dispose = exported.apply({})
  assert.equal(typeof dispose, 'function')
  dispose()
})

test('界面文案只呈现业务语义：状态码与优先级码不得直接暴露给用户', () => {
  const factory = loadClientFactory()
  const exported = factory((spec) => require(spec))

  const statusCases = {
    todo: '待办',
    in_progress: '推进中',
    review: '待验收',
    done: '已完成',
    blocked: '已阻塞',
    failed: '未完成',
    cancelled: '已取消',
  }
  for (const [code, label] of Object.entries(statusCases)) {
    assert.equal(exported.taskStatusLabel(code), label, `状态 ${code} 必须显示为中文业务标签`)
  }
  assert.equal(exported.taskStatusLabel('something-else'), '未知状态', '未知状态不得回显原始码')

  const priorityCases = { urgent: '紧急', high: '高', normal: '普通', low: '低' }
  for (const [code, label] of Object.entries(priorityCases)) {
    assert.equal(exported.taskPriorityLabel(code), label, `优先级 ${code} 必须显示为中文业务标签`)
  }
  assert.equal(exported.taskPriorityLabel('no-such-priority'), '普通', '未知优先级必须有安全的业务默认值')
})
