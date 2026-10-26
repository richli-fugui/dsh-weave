import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openWorkbenchDb } from '../lib/host/db/database.js'
import { WorkbenchDomain, TaskScheduler, HostSessionTracker, apply } from '../lib/index.js'
import { WorkbenchInteractions } from '../lib/host/services/interactions.js'
import { bindWorkbenchExtension, RELAY_METHOD, resolveWorkbenchMode } from '../lib/providers/remoteconnect-relay.js'

function fixture(t) {
  const db = openWorkbenchDb({ dbPath: ':memory:' }); const domain = new WorkbenchDomain(db)
  const tracker = new HostSessionTracker(domain, () => null)
  t.after(() => { tracker.stopBackgroundTracking(); db.close() })
  return { db, domain, tracker }
}

test('review: strict scheduling rejects corrupt prerequisites before queue admission', async t => {
  const { db, domain } = fixture(t)
  const project = domain.createProject({ title: 'test', rootPath: '/test' })
  const task = domain.createTask({ projectId: project.id, title: 'do not execute' })
  db.prepare('UPDATE tasks SET dependencies_json = ? WHERE id = ?').run('{broken', task.id)
  let executions = 0
  const scheduler = new TaskScheduler(domain, async () => { executions++; return { state: 'completed', summary: 'stub' } })
  await assert.rejects(scheduler.dispatchBatch([task.id], 'corrupt'), error => error.code === 'CORRUPT_DEPENDENCIES')
  assert.equal(domain.getTask(task.id).statusCode, 'blocked')
  assert.equal(executions, 0); assert.equal(domain.listRuns().length, 0); assert.equal(scheduler.getQueuedItems().length, 0)
  assert.equal(scheduler.canSchedule(task), false)
})

test('review: a queued task corrupted later is blocked and removed from dispatch queue', async t => {
  const { db, domain } = fixture(t)
  const project = domain.createProject({ title: 'test', rootPath: '/test' })
  const dependency = domain.createTask({ projectId: project.id, title: 'prerequisite' })
  const task = domain.createTask({ projectId: project.id, title: 'queued', dependencies: [dependency.id] })
  let executions = 0
  const scheduler = new TaskScheduler(domain, async () => { executions++; return { state: 'completed', summary: 'stub' } })
  await scheduler.dispatchBatch([task.id], 'queued')
  assert.equal(scheduler.getQueuedItems().length, 1)
  db.prepare('UPDATE tasks SET dependencies_json = ? WHERE id = ?').run('{broken', task.id)
  scheduler.drainQueue()
  assert.equal(domain.getTask(task.id).statusCode, 'blocked')
  assert.equal(scheduler.getQueuedItems().length, 0); assert.equal(executions, 0)
})

test('review: createTask validates project and dependency graph inside its transaction', t => {
  const { db, domain } = fixture(t)
  const project = domain.createProject({ title: 'P', rootPath: '/test' })
  const getProject = domain.getProject.bind(domain)
  domain.getProject = id => { assert.equal(db.isTransaction, true); return getProject(id) }
  domain.createTask({ projectId: project.id, title: 'T' })
})

test('review: explicit abandonment requires exact unknown turn and never claims verified termination', t => {
  const { domain, tracker } = fixture(t)
  tracker.recordTurnStarted({ sessionId: 'old', requestId: 'request', baselineMaxSeq: 0 })
  assert.throws(() => tracker.abandonUnknown('request', true, 'confirmed'))
  tracker.recordTurnUncertain('request')
  assert.throws(() => tracker.abandonUnknown('stale', true, 'confirmed'))
  assert.throws(() => tracker.abandonUnknown('request', false, 'confirmed'))
  const generation = domain.getAssistantState().generation
  tracker.abandonUnknown('request', true, 'user confirmed old host exited')
  assert.equal(tracker.getPendingTurn(), null)
  assert.ok(domain.getAssistantState().generation > generation)
  assert.equal(domain.listOutboxEvents().find(e => e.type === 'assistant.abandoned').payload.terminationVerified, false)
})

test('native question and approval settle their original waterfall, reject stale answers and ignore unrelated agents', async t => {
  const { tracker } = fixture(t); const handlers = new Map()
  const interactions = new WorkbenchInteractions({ on: (event, fn) => handlers.set(event, fn) }, tracker)
  tracker.recordTurnStarted({ sessionId: 'native-owner', requestId: 'native-request', baselineMaxSeq: 0 })
  assert.equal(handlers.get('approval/request')({ agent: { id: 'unrelated' } }, () => 'next'), 'next')
  const question = handlers.get('user-questions/request')({ agent: { id: 'native-owner' }, wait: { callId: 'tool-call' },
    questions: [{ id: 'q1', question: 'Which format?', options: [{ label: 'Markdown' }] }] }, () => assert.fail('owned waterfall must be handled'))
  const pending = interactions.pending()[0]
  assert.equal(pending.nativeId, 'tool-call')
  assert.throws(() => interactions.respond({ ...pending, turnId: 'old', answers: [] }), /过期/)
  interactions.respondText('Markdown')
  assert.deepEqual(await question, { answers: [{ id: 'q1', selected: ['Markdown'] }] })
  assert.throws(() => interactions.respond({ ...pending, answers: [] }), /过期/)
  const approval = handlers.get('approval/request')({ agent: { id: 'native-owner', session: { snapshotEvents: () => [{ type: 'approval/asked', data: { id: 'native-approval' } }] } }, toolName: 'test' }, () => assert.fail())
  assert.equal(interactions.pending()[0].nativeId, 'native-approval')
  interactions.respondText('拒绝')
  assert.equal(await approval, 'rejected')
})

test('Mac relay routes to Windows public extension, has no local database or tools, and never falls back offline', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-mac-relay-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  assert.equal(resolveWorkbenchMode('darwin'), 'client')
  assert.throws(() => resolveWorkbenchMode('darwin', 'host'), /禁止/)
  const extensions = new Map(); const disposers = []
  const windowsRoute = { method: 'GET', path: '/api/workbench/projects', handler: (_req, res) => res.json([{ id: 'same-windows-project' }]) }
  bindWorkbenchExtension({ on: (_e, fn) => disposers.push(fn) }, [windowsRoute], () => ({ host: { server: { registerExtensionMethod: (name, fn) => extensions.set(name, fn) } } }))
  t.after(() => disposers.forEach(fn => fn()))
  const routes = new Map(); let connected = true; let generation = 1; let calls = 0; let changeDuringRequest = false
  const service = { status: async () => ({ mode: 'client', listener: { online: connected }, hostId: 'windows-host', profile: 'desktop', generationId: generation, activeConnectionId: 'paired' }) }
  const connector = { invokeExtension: async (method, request) => { calls++; const result = await extensions.get(method)(request); if (changeDuringRequest) generation++; return result } }
  apply({ webServer: { get: (p,h) => routes.set('GET ' + p,h), post: (p,h) => routes.set('POST ' + p,h) },
    reflect: { get: name => name === 'remoteconnect' ? service : name === 'remoteconnect_client' ? connector : undefined },
    tools: { register: () => assert.fail('Mac must not register local execution tools') } }, { mode: 'client', dbPath: path.join(dir, 'must-not-exist.db') })
  const invoke = async () => { let value, status = 200; const res = { json: v => { value = v }, status: v => { status = v; return res } }; await routes.get('GET /api/workbench/projects')({ query: {} }, res); return { value, status } }
  assert.equal((await invoke()).value[0].id, 'same-windows-project')
  assert.equal(fs.existsSync(path.join(dir, 'must-not-exist.db')), false)
  connected = false
  assert.equal((await invoke()).status, 503); assert.equal(calls, 1)
  connected = true; changeDuringRequest = true
  assert.equal((await invoke()).status, 503)
  await assert.rejects(extensions.get(RELAY_METHOD)({ version: 1, method: 'POST', path: '/arbitrary' }))
})
