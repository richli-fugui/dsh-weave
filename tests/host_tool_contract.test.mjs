import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../lib/index.js'

// T-013：真实 DSH 宿主工具注册契约镜像回归。
// 背景：2026-10-24 隔离 profile 真实宿主（dsh-tools 0.2.1-rc.2）启动时暴露：
//   tool "workbench_create_task" must declare output { schema, render, presentationMeta? }
// 且宿主调用入口为 tool.execute(args, exec)、返回值按 output.schema 严格校验（ToolOutputError）。
// 既有测试桩 tools: { register: () => {} } 无差别放行，无法在 UNIT 层拦截此类契约漂移；
// 本文件按真实宿主行为实现注册镜像与返回值校验，防止再次退化。

const SUPPORTED_KEYWORDS = new Set([
  'type', 'oneOf', 'properties', 'required', 'additionalProperties',
  'items', 'enum', 'const', 'description', 'title',
])

function assertSchemaSubset(node, schemaPath, seen = new Set()) {
  assert.equal(typeof node, 'object', `${schemaPath} must be a schema object`)
  assert.ok(node !== null && !Array.isArray(node), `${schemaPath} must be a schema object`)
  assert.ok(!seen.has(node), `${schemaPath} is circular`)
  seen.add(node)
  for (const key of Object.keys(node)) {
    assert.ok(
      SUPPORTED_KEYWORDS.has(key),
      `${schemaPath}.${key} is not a supported keyword (subset: type/oneOf/properties/required/additionalProperties/items/enum/const + annotations)`,
    )
  }
  if (Object.hasOwn(node, 'oneOf')) {
    assert.ok(!Object.hasOwn(node, 'type'), `${schemaPath} cannot declare both type and oneOf`)
    assert.ok(Array.isArray(node.oneOf), `${schemaPath}.oneOf must be an array`)
    for (const [i, sub] of node.oneOf.entries()) assertSchemaSubset(sub, `${schemaPath}.oneOf[${i}]`, seen)
    return
  }
  assert.ok(typeof node.type === 'string', `${schemaPath} requires type (or oneOf)`)
  // 真实宿主按类型校验关键字：required/properties/additionalProperties 仅允许 object，
  // items 仅允许 array（2026-10-24 真实宿主启动实测：属性级 required: true 会被拒绝）。
  const KEYWORD_ALLOWED_TYPES = {
    properties: ['object'],
    required: ['object'],
    additionalProperties: ['object'],
    items: ['array'],
  }
  for (const [keyword, allowed] of Object.entries(KEYWORD_ALLOWED_TYPES)) {
    if (Object.hasOwn(node, keyword)) {
      assert.ok(allowed.includes(node.type), `${schemaPath}.${keyword} is not supported on type "${node.type}"`)
    }
  }
  if (node.type === 'object') {
    if (Object.hasOwn(node, 'additionalProperties')) {
      assert.equal(typeof node.additionalProperties, 'boolean', `${schemaPath}.additionalProperties must be a boolean`)
    }
    if (Object.hasOwn(node, 'required')) {
      assert.ok(Array.isArray(node.required) && node.required.every((k) => typeof k === 'string'),
        `${schemaPath}.required must be an array of strings`)
      for (const key of node.required) {
        assert.ok(Object.hasOwn(node.properties ?? {}, key), `${schemaPath}.required names "${key}" which is not in properties`)
      }
    }
    for (const [key, sub] of Object.entries(node.properties ?? {})) {
      assertSchemaSubset(sub, `${schemaPath}.properties.${key}`, seen)
    }
  }
  if (node.type === 'array') {
    assert.ok(Object.hasOwn(node, 'items'), `${schemaPath} array requires items`)
    assertSchemaSubset(node.items, `${schemaPath}.items`, seen)
  }
}

// 最小子集值校验器：镜像宿主对返回值的 output.schema 校验（快照后 undefined 字段已剔除）。
function validateValue(schema, value, valuePath) {
  const violations = []
  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return [`${valuePath} must be object`]
    }
    const requiredKeys = Array.isArray(schema.required) ? schema.required : []
    for (const key of requiredKeys) {
      if (!Object.hasOwn(value, key) || value[key] === undefined) violations.push(`${valuePath}.${key} is required`)
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (!Object.hasOwn(value, key) || value[key] === undefined) continue
      violations.push(...validateValue(sub, value[key], `${valuePath}.${key}`))
    }
    for (const key of Object.keys(value)) {
      if (!(schema.properties ?? {})[key] && schema.additionalProperties === false) {
        violations.push(`${valuePath}.${key} is not an allowed property`)
      }
    }
    return violations
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return [`${valuePath} must be array`]
    for (const [i, item] of value.entries()) {
      violations.push(...validateValue(schema.items, item, `${valuePath}[${i}]`))
    }
    return violations
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') violations.push(`${valuePath} must be string`)
    else if (schema.enum && !schema.enum.includes(value)) violations.push(`${valuePath} must be one of ${schema.enum.join('|')}`)
    return violations
  }
  if (schema.type === 'number') {
    if (typeof value !== 'number') violations.push(`${valuePath} must be number`)
    return violations
  }
  if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') violations.push(`${valuePath} must be boolean`)
    return violations
  }
  return violations
}

// 按真实宿主 register() 行为实现的注册镜像桩：违反契约即抛 TypeError。
function createContractToolsStub() {
  const registered = new Map()
  return {
    registered,
    register(definition) {
      const { name, output } = definition
      assert.ok(name, 'tool name is required')
      assert.notEqual(output, undefined, `tool "${name}" must declare output { schema, render, presentationMeta? }`)
      assert.equal(typeof output, 'object', `tool "${name}" output must be an object`)
      assert.equal(typeof output.render, 'function', `tool "${name}" must declare output { schema, render, presentationMeta? }`)
      if (output.presentationMeta !== undefined) {
        assert.equal(typeof output.presentationMeta, 'function', `tool "${name}" presentationMeta must be a function`)
      }
      assertSchemaSubset(output.schema, `tool "${name}".output.schema`)
      assert.equal(typeof definition.execute, 'function', `tool "${name}" must expose execute(args, exec): the real host calls tool.execute, not handler`)
      registered.set(name, definition)
    },
  }
}

test('T-013: 真实宿主工具注册契约镜像', async (t) => {
  await t.test('1. 镜像自检：缺失 output 的注册必须被拒绝（与真实宿主一致）', () => {
    const stub = createContractToolsStub()
    assert.throws(
      () => stub.register({ name: 'bad_tool', parameters: { type: 'object', properties: {} }, execute: async () => ({}) }),
      /must declare output/,
    )
  })

  await t.test('2. apply() 的 5 个 workbench 工具全部通过契约镜像注册且可执行', async () => {
    const seedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-table-tool-contract-'))
    process.env.DSH_WORKBENCH_DEFAULT_ROOT = seedRoot
    const tools = createContractToolsStub()
    const mockCtx = {
      webServer: { get: () => {}, post: () => {} },
      systemPrompt: { addSection: () => {} },
      tools,
    }
    apply(mockCtx, { dbPath: ':memory:' })

    const expected = [
      'workbench_create_task',
      'workbench_start_run',
      'workbench_stop',
      'workbench_list_projects',
      'workbench_list_tasks',
    ]
    for (const name of expected) {
      assert.ok(tools.registered.has(name), `缺少工具注册: ${name}`)
    }
    assert.equal(tools.registered.size, expected.length, '不应出现意外的额外工具注册')
  })

  await t.test('3. 每个工具的实际返回值必须通过其声明的 output.schema 校验', async () => {
    const seedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-table-tool-values-'))
    process.env.DSH_WORKBENCH_DEFAULT_ROOT = seedRoot
    const tools = createContractToolsStub()
    const mockCtx = {
      webServer: { get: () => {}, post: () => {} },
      systemPrompt: { addSection: () => {} },
      tools,
    }
    apply(mockCtx, { dbPath: ':memory:' })

    const listRes = await tools.registered.get('workbench_list_projects').execute({})
    assert.deepEqual(validateValue(tools.registered.get('workbench_list_projects').output.schema, listRes, 'value'), [],
      'workbench_list_projects 返回值必须符合 output.schema')

    const projectId = listRes.projects[0]?.id
    assert.ok(projectId, '种子数据应至少包含一个项目')

    const created = await tools.registered.get('workbench_create_task').execute({
      projectId,
      title: '契约镜像验证卡',
      goal: '验证工具返回值与声明 schema 一致',
      acceptance: '返回值通过 output.schema 校验',
    })
    assert.deepEqual(validateValue(tools.registered.get('workbench_create_task').output.schema, created, 'value'), [],
      'workbench_create_task 返回值必须符合 output.schema')

    const listed = await tools.registered.get('workbench_list_tasks').execute({ projectId })
    assert.deepEqual(validateValue(tools.registered.get('workbench_list_tasks').output.schema, listed, 'value'), [],
      'workbench_list_tasks 返回值必须符合 output.schema')

    const stopRes = await tools.registered.get('workbench_stop').execute({ targetKind: 'all' })
    assert.deepEqual(validateValue(tools.registered.get('workbench_stop').output.schema, stopRes, 'value'), [],
      'workbench_stop 返回值必须符合 output.schema')

    // workbench_start_run 会触发真实调度；模型桥接不可用时 Worker 走诚实失败路径，
    // 这里只校验受理时返回的 Run 对象符合 schema。
    const run = await tools.registered.get('workbench_start_run').execute({
      taskId: created.id,
      clientRequestId: `tool-contract-${Date.now()}`,
    })
    assert.ok(run && typeof run.id === 'string', 'start_run 必须返回 Run 对象')
    assert.deepEqual(validateValue(tools.registered.get('workbench_start_run').output.schema, run, 'value'), [],
      'workbench_start_run 返回值必须符合 output.schema')
  })
})
