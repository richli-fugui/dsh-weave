import test from 'node:test'
import assert from 'node:assert/strict'
import { openWorkbenchDb } from '../lib/host/db/database.js'
import { WorkbenchDomain } from '../lib/host/services/domain.js'
import { LocalProvider } from '../lib/providers/local.js'
import { RemoteProvider, WORKBENCH_REMOTE_CONTRACT_VERSION, isContractCompatible } from '../lib/providers/remote.js'
import { WorkbenchError, UnknownOutcomeError } from '../lib/shared/errors.js'

/**
 * Gate 5b：RemoteProvider 与 0.1-draft 联合契约的符合性测试（替身层）。
 * 证据层 = UNIT/MOCK。stub 通过只证明接口语义；真实 Mac + Windows 联调仍为 NOT_RUN。
 */

function createStubAdapter(domain, overrides = {}) {
  const calls = []
  const subs = []
  const generationCallbacks = new Set()
  let generation = 0
  const adapter = {
    connectionId: 'conn-stub-01',
    ready: true,
    authState: 'ready',
    identityVersion: WORKBENCH_REMOTE_CONTRACT_VERSION,
    failInvoke: null,
    calls,
    subs,
    identityCalls: 0,
    isReady() {
      return adapter.ready
    },
    getState() {
      return adapter.authState
    },
    async invoke(endpoint, payload) {
      calls.push({ endpoint, payload, generation })
      if (endpoint === 'workbench.identity.get') {
        adapter.identityCalls++
        if (adapter.identityVersion === null) throw new Error(`Unknown endpoint: ${endpoint}`)
        if (adapter.failInvoke) throw adapter.failInvoke(endpoint, payload)
        return {
          hostId: 'host-win-01',
          profileId: 'desktop',
          dshVersion: '0.0.0-test',
          connectionProtocolVersion: '0.1',
          serverEpoch: `epoch-${generation}`,
          workbenchContractVersion: adapter.identityVersion,
          capabilities: ['extension.invoke', 'extension.follow'],
        }
      }
      if (adapter.failInvoke) throw adapter.failInvoke(endpoint, payload)
      switch (endpoint) {
        case 'workbench.projects.create':
          return domain.createProject(payload)
        case 'workbench.projects.list':
          return domain.listProjects()
        case 'workbench.tasks.create':
          return domain.createTask(payload)
        case 'workbench.tasks.list':
          return domain.listTasks(payload?.projectId)
        case 'workbench.tasks.update':
          return domain.updateTask(payload)
        case 'workbench.runs.start':
          return domain.startRun(payload)
        case 'workbench.runs.complete':
          return domain.completeRun(payload)
        case 'workbench.runs.list':
          return domain.listRuns(payload?.taskId)
        case 'workbench.control.snapshot':
          return { activeCount: 0, queuedCount: 0, awaitingCount: 0, items: [] }
        case 'workbench.control.stopRun':
          return domain.stopRun?.(payload) ?? { commandId: payload.clientRequestId, status: 'already_terminal', stoppedRunIds: [] }
        default:
          throw new Error(`Unknown endpoint: ${endpoint}`)
      }
    },
    follow(endpoint, payload, onData) {
      const sub = { endpoint, payload, onData, active: true }
      subs.push(sub)
      return () => {
        sub.active = false
      }
    },
    onGenerationChange(cb) {
      generationCallbacks.add(cb)
      return () => generationCallbacks.delete(cb)
    },
    bumpGeneration() {
      generation++
      for (const cb of generationCallbacks) cb(generation)
    },
  }
  Object.assign(adapter, overrides)
  return adapter
}

function pick(obj, keys) {
  const out = {}
  for (const k of keys) out[k] = obj?.[k]
  return out
}

test('Gate 5b RemoteProvider 契约符合性（0.1-draft，替身层）', async (t) => {
  await t.test('1. 契约版本工具函数：同族兼容、异族与缺失不兼容', () => {
    assert.equal(isContractCompatible('0.1-draft'), true)
    assert.equal(isContractCompatible('0.1-rc2'), true)
    assert.equal(isContractCompatible('0.2-draft'), false)
    assert.equal(isContractCompatible(undefined), false)
    assert.equal(isContractCompatible(''), false)
    assert.equal(WORKBENCH_REMOTE_CONTRACT_VERSION, '0.1-draft')
  })

  await t.test('2. S2 等价性：LocalProvider 与 RemoteProvider 对同一领域用例产生相同可观测结果', async () => {
    const domainLocal = new WorkbenchDomain(openWorkbenchDb({ dbPath: ':memory:' }))
    const domainRemote = new WorkbenchDomain(openWorkbenchDb({ dbPath: ':memory:' }))
    const local = new LocalProvider(domainLocal)
    const remote = new RemoteProvider(createStubAdapter(domainRemote))

    const seed = {
      project: { id: 'eq-proj', title: '等价项目', rootPath: 'C:\\Projects\\Eq', goal: 'S2 等价性验证' },
      taskA: { id: 'eq-task-a', projectId: 'eq-proj', title: '任务A' },
      taskB: { id: 'eq-task-b', projectId: 'eq-proj', title: '任务B', dependencies: ['eq-task-a'] },
    }

    for (const [tag, provider] of [['local', local], ['remote', remote]]) {
      await provider.createProject(seed.project)
      await provider.createTask(seed.taskA)
      await provider.createTask(seed.taskB)
      const run = await provider.startRun({ taskId: 'eq-task-a', clientRequestId: 'req-eq-a1' })
      const comp = await provider.completeRun({
        runId: run.id,
        state: 'completed',
        summary: 'A 已完成，B 应解锁',
        artifactRefs: [{ title: 'out.txt', path: 'out.txt' }],
        suggestedTaskStatus: 'done',
      })
      await provider.startRun({ taskId: 'eq-task-b', clientRequestId: 'req-eq-b1' })
      if (tag === 'local') local._lastComp = comp
      else remote._lastComp = comp
    }

    const lp = domainLocal
    const rp = domainRemote
    const projKeys = ['id', 'title', 'rootPath', 'goal', 'status', 'revision']
    const taskKeys = ['id', 'projectId', 'title', 'goal', 'acceptance', 'statusCode', 'priorityCode', 'dependencies', 'progressPercent', 'revision']
    assert.deepEqual(pick(lp.getProject('eq-proj'), projKeys), pick(rp.getProject('eq-proj'), projKeys))
    assert.deepEqual(pick(lp.getTask('eq-task-a'), taskKeys), pick(rp.getTask('eq-task-a'), taskKeys))
    assert.deepEqual(pick(lp.getTask('eq-task-b'), taskKeys), pick(rp.getTask('eq-task-b'), taskKeys))
    assert.equal(lp.getTask('eq-task-b').statusCode, 'in_progress')

    const runKeys = ['taskId', 'clientRequestId', 'state']
    const lRun = lp.listRuns('eq-task-a')[0]
    const rRun = rp.listRuns('eq-task-a')[0]
    assert.deepEqual(pick(lRun, runKeys), pick(rRun, runKeys))
    const resultKeys = ['summary', 'reviewState', 'artifactRefs', 'evidenceRefs', 'nextActions']
    assert.deepEqual(
      pick(local._lastComp.result, resultKeys),
      pick(remote._lastComp.result, resultKeys),
    )
    // 远端写入真实落在 Windows 侧权威 DB，不是 Mac 本地副本
    assert.equal(rp.listRuns('eq-task-a').length, 1)
  })

  await t.test('3. 版本协商：对端声明不兼容契约版本时硬阻塞且无副作用', async () => {
    const domain = new WorkbenchDomain(openWorkbenchDb({ dbPath: ':memory:' }))
    const adapter = createStubAdapter(domain, { identityVersion: '0.2-draft' })
    const remote = new RemoteProvider(adapter)

    await assert.rejects(
      () => remote.createProject({ id: 'p1', title: 'x', rootPath: 'C:\\x' }),
      (err) => err instanceof WorkbenchError && err.code === 'UNSUPPORTED_VERSION',
    )
    assert.equal(domain.listProjects().length, 0, '不兼容版本时不得产生任何业务副作用')

    // 对端升级到同族版本后恢复可用
    adapter.identityVersion = WORKBENCH_REMOTE_CONTRACT_VERSION
    const proj = await remote.createProject({ id: 'p1', title: 'x', rootPath: 'C:\\x' })
    assert.equal(proj.id, 'p1')
  })

  await t.test('4. 对端未实现身份端点（纯 stub）：进入未验证兼容模式并如实标注', async () => {
    const domain = new WorkbenchDomain(openWorkbenchDb({ dbPath: ':memory:' }))
    const adapter = createStubAdapter(domain, { identityVersion: null })
    const remote = new RemoteProvider(adapter)
    const proj = await remote.createProject({ id: 'compat-p', title: 'x', rootPath: 'C:\\x' })
    assert.equal(proj.id, 'compat-p')
    const info = remote.getIdentity()
    assert.equal(info.verified, true)
    assert.equal(info.compatMode, true)
    assert.equal(info.identity, null)
  })

  await t.test('5. auth_required 与 offline 严格区分，不混同为 OFFLINE', async () => {
    const domain = new WorkbenchDomain(openWorkbenchDb({ dbPath: ':memory:' }))
    const adapter = createStubAdapter(domain, { ready: true, authState: 'auth_required' })
    const remote = new RemoteProvider(adapter)
    await assert.rejects(
      () => remote.getControlSnapshot(),
      (err) => err instanceof WorkbenchError && err.code === 'AUTH_REQUIRED',
    )
    adapter.authState = 'ready'
    adapter.ready = false
    await assert.rejects(
      () => remote.getControlSnapshot(),
      (err) => err instanceof WorkbenchError && err.code === 'OFFLINE',
    )
  })

  await t.test('6. 写命令自动注入 clientRequestId；startRun 原样透传业务键；错误不自动重发', async () => {
    const domain = new WorkbenchDomain(openWorkbenchDb({ dbPath: ':memory:' }))
    const adapter = createStubAdapter(domain)
    const remote = new RemoteProvider(adapter)
    await remote.createProject({ id: 'pw', title: 'x', rootPath: 'C:\\x' })
    await remote.createTask({ id: 'tw', projectId: 'pw', title: 't' })

    const createCall = adapter.calls.find((c) => c.endpoint === 'workbench.tasks.create')
    assert.ok(typeof createCall.payload.clientRequestId === 'string' && createCall.payload.clientRequestId.length > 8)

    // startRun 的 clientRequestId 是业务幂等键，必须原样保留
    const run = await remote.startRun({ taskId: 'tw', clientRequestId: 'biz-key-001' })
    const startCall = adapter.calls.find((c) => c.endpoint === 'workbench.runs.start')
    assert.equal(startCall.payload.clientRequestId, 'biz-key-001')
    assert.equal(run.clientRequestId, 'biz-key-001')

    // unknown_outcome 映射且只调用一次（禁止自动重发非幂等副作用）
    adapter.failInvoke = () => {
      const e = new Error('ack lost')
      e.code = 'UNKNOWN_OUTCOME'
      return e
    }
    await assert.rejects(
      () => remote.stopRun(run.id),
      (err) => err instanceof UnknownOutcomeError,
    )
    const stopCalls = adapter.calls.filter((c) => c.endpoint === 'workbench.control.stopRun')
    assert.equal(stopCalls.length, 1)
    assert.ok(typeof stopCalls[0].payload.clientRequestId === 'string')
    assert.ok(typeof stopCalls[0].payload.runId === 'string')
    adapter.failInvoke = null
  })

  await t.test('7. 冲突按 CONFLICT 分类透出，保留 expectedRevision 语义', async () => {
    const domain = new WorkbenchDomain(openWorkbenchDb({ dbPath: ':memory:' }))
    const adapter = createStubAdapter(domain)
    const remote = new RemoteProvider(adapter)
    await remote.createProject({ id: 'pc', title: 'x', rootPath: 'C:\\x' })
    await remote.createTask({ id: 'tc', projectId: 'pc', title: 't' })

    await remote.updateTask({ id: 'tc', title: 'v2', expectedRevision: 1 })
    await assert.rejects(
      () => remote.updateTask({ id: 'tc', title: 'v3', expectedRevision: 1 }),
      (err) => err instanceof WorkbenchError && err.code === 'CONFLICT',
    )
    assert.equal(domain.getTask('tc').title, 'v2')
  })

  await t.test('8. generation 变化：旧订阅失效、身份作废、下次调用重新协商', async () => {
    const domain = new WorkbenchDomain(openWorkbenchDb({ dbPath: ':memory:' }))
    const adapter = createStubAdapter(domain)
    const remote = new RemoteProvider(adapter)
    await remote.createProject({ id: 'pg', title: 'x', rootPath: 'C:\\x' })
    const identityCallsAfterFirst = adapter.identityCalls
    assert.ok(identityCallsAfterFirst >= 1, '首次写命令前完成身份协商')

    const seen = []
    const dispose = remote.followEvents(0, (ev) => seen.push(ev.sequence))
    const sub = adapter.subs[adapter.subs.length - 1]
    assert.ok(sub && sub.active)

    adapter.bumpGeneration()
    assert.equal(sub.active, false, 'generation 变化后旧订阅必须被失效')

    // 下一次调用触发重新协商（identity 调用数增加）且业务继续可用
    await remote.listProjects()
    assert.ok(adapter.identityCalls > identityCallsAfterFirst, 'generation 变化后重新协商身份')
    const info = remote.getIdentity()
    assert.equal(info.verified, true)
    assert.equal(info.compatMode, false)
    dispose()
  })

  await t.test('9. followEvents 按 sequence 去重与单调推进，重复/回退投递不重复回调', async () => {
    const domain = new WorkbenchDomain(openWorkbenchDb({ dbPath: ':memory:' }))
    const adapter = createStubAdapter(domain)
    const remote = new RemoteProvider(adapter)
    const seen = []
    remote.followEvents(0, (ev) => seen.push(ev.sequence))
    const sub = adapter.subs[adapter.subs.length - 1]
    const mk = (sequence) => ({
      sequence,
      entityId: `e${sequence}`,
      type: 'test',
      payload: {},
      deliveryState: 'delivered',
      createdAt: new Date().toISOString(),
    })
    for (const s of [1, 2, 2, 1, 3]) sub.onData(mk(s))
    assert.deepEqual(seen, [1, 2, 3])
  })

  await t.test('10. (T-011a) in-flight 请求期间 generation 变化：读操作丢弃旧响应并报错 CANCELLED，写操作阻断并报错 UNKNOWN_OUTCOME', async () => {
    let generationCallback
    let releaseRead
    let releaseWrite
    const adapter = {
      connectionId: 'audit-connection',
      isReady: () => true,
      onGenerationChange: (cb) => {
        generationCallback = cb
        return () => {}
      },
      invoke: async (endpoint, payload) => {
        if (endpoint === 'workbench.identity.get') {
          return { hostId: 'old-host', profileId: 'desktop', workbenchContractVersion: WORKBENCH_REMOTE_CONTRACT_VERSION }
        }
        if (endpoint === 'workbench.projects.list') {
          return new Promise((resolve) => { releaseRead = resolve })
        }
        if (endpoint === 'workbench.projects.create') {
          return new Promise((resolve) => { releaseWrite = resolve })
        }
        return {}
      },
      follow: () => () => {},
    }
    const provider = new RemoteProvider(adapter)
    await provider.negotiate()

    // 读操作在途时发生代次变化
    const pendingRead = provider.listProjects()
    while (!releaseRead) await Promise.resolve()
    generationCallback(2)
    releaseRead([{ id: 'old-generation-project' }])

    await assert.rejects(
      async () => pendingRead,
      (err) => err instanceof WorkbenchError && err.code === 'CANCELLED',
      '代次变更后旧读请求响应必须被废弃并抛出 CANCELLED',
    )

    // 写操作在途时发生代次变化
    const pendingWrite = provider.createProject({ id: 'late-proj', title: 'Late', rootPath: 'C:\\Late' })
    while (!releaseWrite) await Promise.resolve()
    generationCallback(3)
    releaseWrite({ id: 'late-proj' })

    await assert.rejects(
      async () => pendingWrite,
      (err) => err instanceof UnknownOutcomeError && err.code === 'UNKNOWN_OUTCOME',
      '写请求在途时代次变更，必须抛出 UNKNOWN_OUTCOME',
    )
  })

  await t.test('10. (T-011b) 身份协商遭遇一般性后端故障时严禁降级放行业务写操作', async () => {
    let sideEffects = 0
    const failedIdentity = new RemoteProvider({
      connectionId: 'audit-identity-failure',
      isReady: () => true,
      invoke: async (endpoint) => {
        if (endpoint === 'workbench.identity.get') throw new Error('backend temporarily failed')
        sideEffects++
        return { id: 'unexpected-command' }
      },
      follow: () => () => {},
    })

    await assert.rejects(
      async () => failedIdentity.createWorkIntent('isolated audit'),
      (err) => err instanceof WorkbenchError && err.code === 'DOMAIN_ERROR',
      '一般性身份故障必须原样阻断业务调用',
    )
    assert.equal(sideEffects, 0, '发生后端一般性身份故障时不得触发后续任何业务写操作')
  })
})
