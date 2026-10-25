import test from 'node:test'
import assert from 'node:assert/strict'
import { openWorkbenchDb } from '../lib/host/db/database.js'
import { WorkbenchDomain, HostSessionTracker, LocalProvider } from '../lib/index.js'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const empty = () => ({ activeCount: 0, queuedCount: 0, awaitingCount: 0, unknownCount: 0, items: [] })
function fixture(t, bridge, options = {}) {
  if (bridge) bridge.eventsOf ??= async () => []
  const db = openWorkbenchDb({ dbPath: ':memory:' })
  const domain = new WorkbenchDomain(db)
  const tracker = new HostSessionTracker(domain, () => bridge, { pollIntervalMs: 5, ...options })
  tracker.recordTurnStarted({ sessionId: 'host-A', requestId: 'turn-A', baselineMaxSeq: 0 })
  t.after(() => { tracker.stopBackgroundTracking(); db.close() })
  return { db, domain, tracker }
}

test('host stop: unavailable bridge never reports stopped or loses durable control', async t => {
  const { domain, tracker } = fixture(t, null)
  const result = await tracker.stopAll(5)
  assert.equal(result.status, 'conflict')
  assert.deepEqual(result.stoppedRunIds, [])
  assert.equal(tracker.augmentControlSnapshot(empty()).unknownCount, 1)
  assert.ok(domain.getAssistantState().memoryIndex.pendingHostTurn)
  const restarted = new HostSessionTracker(domain, () => null)
  await restarted.reconcileOnStartup()
  assert.equal(restarted.augmentControlSnapshot(empty()).unknownCount, 1)
  restarted.stopBackgroundTracking()
})

for (const fault of ['unresolved', 'throw']) {
  test(`host stop: ${fault} diagnosis cannot prove termination`, async t => {
    const bridge = { cancel: async () => true, diagnose: async () => {
      if (fault === 'throw') throw Error('offline')
      return { agentStatus: 'unresolved' }
    } }
    const { tracker } = fixture(t, bridge)
    const result = await tracker.stopAll(5)
    assert.equal(result.status, 'waiting_tool_exit')
    assert.deepEqual(result.stoppedRunIds, [])
    assert.equal(tracker.augmentControlSnapshot(empty()).unknownCount, 1)
  })
}

test('host observation deadline keeps unknown work visible after restart, never replays prompt', async t => {
  let calls = 0
  const bridge = { diagnose: async () => ({ agentStatus: 'running' }), prompt: () => calls++ }
  const { domain, tracker } = fixture(t, bridge, { maxTrackingMs: 1 })
  tracker.startBackgroundTracking('host-A', 0)
  await sleep(30)
  assert.equal(tracker.augmentControlSnapshot(empty()).unknownCount, 1)
  assert.ok(domain.getAssistantState().memoryIndex.pendingHostTurn)
  assert.equal(calls, 0)
})

test('host tracker disposal invalidates a poll already awaiting the host', async t => {
  let resolveDiag
  const bridge = { diagnose: () => new Promise(resolve => { resolveDiag = resolve }), eventsOf: async () => [] }
  const { domain, tracker } = fixture(t, bridge)
  tracker.startBackgroundTracking('host-A', 0)
  while (!resolveDiag) await sleep(2)
  tracker.stopBackgroundTracking()
  resolveDiag({ agentStatus: 'idle' })
  await sleep(15)
  assert.equal(domain.listOutboxEvents().filter(e => e.type === 'assistant.turn_completed').length, 0)
  assert.equal(tracker.getPendingTurn()?.requestId, 'turn-A')
})

test('host stop aliases target the real session and local aggregation preserves conflict', async t => {
  let cancelledId
  const { tracker } = fixture(t, { cancel: async id => { cancelledId = id; return true }, diagnose: async () => ({ agentStatus: 'idle' }) })
  const provider = new LocalProvider(null, undefined, undefined, tracker)
  const result = await provider.stopRun('main-assistant')
  assert.equal(cancelledId, 'host-A')
  assert.equal(result.status, 'stopped')
  assert.equal(tracker.getPendingTurn(), null)
  const missing = fixture(t, null)
  const combined = new LocalProvider(null, { stopAll: async () => ({ commandId: 'workers', status: 'stopped', stoppedRunIds: ['worker'] }) }, undefined, missing.tracker)
  assert.equal((await combined.stopAll()).status, 'conflict')
})

test('project creation rolls back both entity and event when outbox persistence fails', t => {
  const db = openWorkbenchDb({ dbPath: ':memory:' })
  t.after(() => db.close())
  class FailingOutbox extends WorkbenchDomain {
    appendOutboxEvent(id, type, payload) { super.appendOutboxEvent(id, type, payload); throw Error('injected outbox fault') }
  }
  const domain = new FailingOutbox(db)
  assert.throws(() => domain.createProject({ title: 'isolated', rootPath: '/test/project' }), /outbox fault/)
  assert.equal(domain.listProjects().length, 0)
  assert.equal(domain.listOutboxEvents().length, 0)
})

test('late prompt callbacks cannot clear stopping; background exit reconciles exactly once', async t => {
  let state = 'running'
  const events = [{ seq: 1, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'retained result' }] } } }]
  const bridge = { cancel: async () => true, diagnose: async () => ({ agentStatus: state }), eventsOf: async () => events }
  const { domain, tracker } = fixture(t, bridge)
  const result = await tracker.stopAll(0)
  assert.equal(result.status, 'waiting_tool_exit')
  tracker.recordTurnCompleted('late foreground reply', 'turn-A')
  await tracker.recordTurnAwaitingInput('late question', undefined, 'turn-A')
  assert.equal(tracker.getPendingTurn().stopRequested, true)
  state = 'idle'
  await sleep(35)
  assert.equal(tracker.getPendingTurn(), null)
  assert.equal(domain.listChatMessages().filter(m => m.text === 'retained result').length, 1)
  const restarted = new HostSessionTracker(domain, () => bridge)
  await restarted.reconcileOnStartup()
  assert.equal(domain.listChatMessages().filter(m => m.text === 'retained result').length, 1)
  restarted.stopBackgroundTracking()
})

test('failed late-delivery transaction retains pending; control reconciliation recovers without replay', async t => {
  const bridge = { diagnose: async () => ({ agentStatus: 'idle' }), eventsOf: async () => [
    { seq: 1, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'atomic reply' }] } } },
  ] }
  const { db, domain, tracker } = fixture(t, bridge)
  const append = domain.appendOutboxEvent.bind(domain)
  domain.appendOutboxEvent = (...args) => { append(...args); throw Error('injected write failure') }
  await tracker.reconcileOnStartup()
  assert.equal(domain.listChatMessages().length, 0)
  assert.equal(domain.getAssistantState().memoryIndex.pendingHostTurn.status, 'unknown')
  domain.appendOutboxEvent = append
  const provider = new LocalProvider(domain, undefined, undefined, tracker)
  const result = await provider.autoReconcileWithWorker()
  assert.equal(result.reconciled.length, 1)
  assert.equal(domain.listChatMessages().filter(m => m.text === 'atomic reply').length, 1)
  assert.equal((await provider.getControlSnapshot()).unknownCount, 0)
})

for (const corrupted of ['{broken', '{}', '[null]', '[""]']) {
  test('corrupt prerequisites remain readable but cannot admit execution or be silently erased: ' + corrupted, t => {
    const db = openWorkbenchDb({ dbPath: ':memory:' })
    t.after(() => db.close())
    const domain = new WorkbenchDomain(db)
    const project = domain.createProject({ title: 'dependency fixture', rootPath: '/test/project' })
    const task = domain.createTask({ projectId: project.id, title: 'dependent' })
    db.prepare('UPDATE tasks SET dependencies_json = ? WHERE id = ?').run(corrupted, task.id)
    assert.equal(domain.listTasks().length, 1)
    assert.throws(() => domain.startRun({ taskId: task.id, clientRequestId: 'do-not-execute' }), err => err.code === 'CORRUPT_DEPENDENCIES')
    assert.equal(domain.listRuns().length, 0)
    assert.throws(() => domain.updateTask({ id: task.id, expectedRevision: task.revision, title: 'rename only' }), err => err.code === 'CORRUPT_DEPENDENCIES')
    assert.equal(db.prepare('SELECT dependencies_json FROM tasks WHERE id = ?').get(task.id).dependencies_json, corrupted)
    const repaired = domain.updateTask({ id: task.id, expectedRevision: task.revision, dependencies: [] })
    assert.deepEqual(repaired.dependencies, [])
    assert.ok(domain.startRun({ taskId: task.id, clientRequestId: 'after-explicit-repair' }))
  })
}
