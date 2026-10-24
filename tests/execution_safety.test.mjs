import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, appendFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { openWorkbenchDb } from '../lib/host/db/database.js'
import { WorkbenchDomain } from '../lib/host/services/domain.js'
import { TaskScheduler } from '../lib/host/services/scheduler.js'
import { LocalProvider } from '../lib/providers/local.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))
async function idle(scheduler) {
  for (let i = 0; i < 100 && (scheduler.getActiveRunCount() || scheduler.getQueuedCount()); i++) await sleep(5)
  assert.equal(scheduler.getActiveRunCount(), 0)
}
function setup(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'table-safety-'))
  const db = openWorkbenchDb({ dbPath: join(dir, 'test.db') })
  const domain = new WorkbenchDomain(db)
  const p = domain.createProject({ title: 'isolated office project', rootPath: dir })
  const task = domain.createTask({ projectId: p.id, title: 'one business operation' })
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }) })
  return { dir, db, domain, p, task, ...options }
}

test('execution safety: replay after completion returns the original Run without a second side effect', async t => {
  const { dir, domain, task } = setup(t)
  const sideEffects = join(dir, 'effects.txt')
  const scheduler = new TaskScheduler(domain, async () => {
    appendFileSync(sideEffects, 'executed\n')
    return { state: 'completed', summary: 'delivered', suggestedTaskStatus: 'review' }
  })
  const provider = new LocalProvider(domain, scheduler)
  const input = { taskId: task.id, clientRequestId: 'stable-completed' }
  const first = await provider.startRun(input)
  await idle(scheduler)
  const replay = await provider.startRun(input)
  await idle(scheduler)
  assert.equal(replay.id, first.id)
  assert.equal(replay.state, 'completed')
  assert.equal(first.clientRequestId, input.clientRequestId)
  assert.equal(readFileSync(sideEffects, 'utf8'), 'executed\n')
})

test('execution safety: lost ACK retry while running never queues or executes another copy', async t => {
  const { domain, task } = setup(t)
  let release
  const hold = new Promise(r => { release = r })
  let executions = 0
  const scheduler = new TaskScheduler(domain, async () => {
    executions++
    await hold
    return { state: 'completed', summary: 'one' }
  })
  const provider = new LocalProvider(domain, scheduler)
  const input = { taskId: task.id, clientRequestId: 'same-running' }
  const first = await provider.startRun(input)
  try {
    const replay = await provider.startRun(input)
    assert.equal(replay.id, first.id)
    assert.equal(scheduler.getQueuedCount(), 0)
  } finally { release() }
  await idle(scheduler)
  assert.equal(executions, 1)
})

test('execution safety: one request key cannot silently refer to another task or intent', async t => {
  const { domain, p, task } = setup(t)
  const another = domain.createTask({ projectId: p.id, title: 'different work' })
  domain.startRun({ taskId: task.id, clientRequestId: 'collision' })
  assert.throws(() => domain.startRun({ taskId: another.id, clientRequestId: 'collision' }), e => e.code === 'CONFLICT')
  const intent = domain.createWorkIntent('changed scope', p.id)
  assert.throws(() => domain.startRun({ taskId: task.id, clientRequestId: 'collision', intentId: intent.id }), e => e.code === 'CONFLICT')
})

test('execution safety: startup preserves uncertain executions and protects their project', async t => {
  const { db, domain, task, p } = setup(t)
  const first = domain.startRun({ taskId: task.id, clientRequestId: 'before-crash', workerSessionId: 'worker-accepted' })
  const sameProject = domain.createTask({ projectId: p.id, title: 'must wait for reconciliation' })
  const otherProject = domain.createProject({ title: 'unrelated project', rootPath: p.rootPath })
  const safeTask = domain.createTask({ projectId: otherProject.id, title: 'can continue' })
  let executed = []
  const scheduler = new TaskScheduler(domain, async tsk => {
    executed.push(tsk.id)
    return { state: 'completed', summary: 'safe' }
  }, { allowSameProjectParallel: true })
  assert.equal(domain.getRun(first.id).state, 'unknown')
  assert.equal(domain.getRun(first.id).workerSessionId, 'worker-accepted')
  assert.equal(domain.getRun(first.id).finishedAt, undefined)
  assert.equal(domain.getTask(task.id).statusCode, 'blocked')
  assert.equal(scheduler.getControlSnapshot().items.find(x => x.runId === first.id)?.state, 'unknown')
  assert.equal(scheduler.canSchedule(sameProject), false)
  await assert.rejects(new LocalProvider(domain, scheduler).startRun({ taskId: task.id, clientRequestId: 'new-key' }),
    e => e.code === 'UNKNOWN_OUTCOME')
  const stop = await scheduler.stopRun(first.id, 10)
  assert.equal(stop.status, 'conflict')
  assert.deepEqual(stop.pendingToolIds, [first.id])
  const all = await scheduler.stopAll(10)
  assert.equal(all.status, 'waiting_tool_exit')
  assert.ok(all.pendingToolIds.includes(first.id))
  await scheduler.dispatchBatch([safeTask.id], 'unrelated')
  await idle(scheduler)
  assert.deepEqual(executed, [safeTask.id])
  const revision = domain.getTask(task.id).revision
  domain.reconcileCrashedRunsOnStartup()
  assert.equal(domain.getTask(task.id).revision, revision, 'repeated recovery must be idempotent')
  assert.equal(db.prepare("SELECT count(*) n FROM outbox_events WHERE type='run.recovery_required'").get().n, 1)
})

test('execution safety: queue claim and Run admission roll back together on persistence failure', t => {
  const { db, domain, task, p } = setup(t)
  domain.enqueueTask({ id: 'claim', taskId: task.id, clientRequestId: 'claim-key',
    taskTitle: task.title, projectId: p.id, controlEpoch: 0 })
  db.exec("CREATE TRIGGER fail_claim BEFORE UPDATE OF status ON task_queue WHEN NEW.status = 'started' BEGIN SELECT RAISE(ABORT, 'fault injected'); END")
  assert.throws(() => domain.admitRun({ taskId: task.id, clientRequestId: 'claim-key' }, 'claim'), /fault injected/)
  assert.equal(domain.listRuns().length, 0)
  assert.equal(domain.listPendingQueue().length, 1)
  assert.equal(domain.getTask(task.id).statusCode, 'todo')
  assert.equal(domain.listOutboxEvents(0, 50).filter(e => e.type === 'run.started').length, 0)
  db.exec('DROP TRIGGER fail_claim')
  const accepted = domain.admitRun({ taskId: task.id, clientRequestId: 'claim-key' }, 'claim')
  assert.equal(accepted.created, true)
  assert.equal(domain.listPendingQueue().length, 0)
  assert.equal(domain.admitRun({ taskId: task.id, clientRequestId: 'claim-key' }, 'claim').created, false)
})

test('execution safety: legacy consumed queue without a Run becomes visible unknown, never cancelled success', t => {
  const { db, domain, p, task } = setup(t)
  domain.enqueueTask({ id: 'legacy', taskId: task.id, clientRequestId: 'legacy-key',
    taskTitle: task.title, projectId: p.id, controlEpoch: 0 })
  domain.updateQueueItemStatus('legacy', 'started')
  const scheduler = new TaskScheduler(domain, async () => assert.fail('must not execute uncertain legacy claim'))
  assert.equal(db.prepare("SELECT status FROM task_queue WHERE id='legacy'").get().status, 'unknown')
  assert.equal(domain.getTask(task.id).statusCode, 'blocked')
  assert.equal(scheduler.getControlSnapshot().items.find(x => x.runId === 'legacy')?.state, 'unknown')
})

test('execution safety: real child process exits after side effect, restart never repeats the operation', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'table-child-crash-'))
  let recoveryDb
  t.after(() => { recoveryDb?.close(); rmSync(dir, { recursive: true, force: true }) })
  const dbPath = join(dir, 'test.db')
  const effectPath = join(dir, 'effects.txt')
  const childCode = [
    'import { appendFileSync } from "node:fs"',
    'import { openWorkbenchDb } from ' + JSON.stringify(pathToFileURL(resolve('lib/host/db/database.js')).href),
    'import { WorkbenchDomain } from ' + JSON.stringify(pathToFileURL(resolve('lib/host/services/domain.js')).href),
    'import { TaskScheduler } from ' + JSON.stringify(pathToFileURL(resolve('lib/host/services/scheduler.js')).href),
    'const db = openWorkbenchDb({dbPath:' + JSON.stringify(dbPath) + '})',
    'const domain = new WorkbenchDomain(db)',
    'domain.createProject({id:"project",title:"temporary",rootPath:' + JSON.stringify(dir) + '})',
    'domain.createTask({id:"task",projectId:"project",title:"business operation"})',
    'domain.enqueueTask({id:"queued-before-crash", taskId:"task", clientRequestId:"crash-task", taskTitle:"operation", projectId:"project", controlEpoch:0})',
    'const scheduler = new TaskScheduler(domain, async () => { appendFileSync(' + JSON.stringify(effectPath) + ', "once\\n"); process.exit(73) })',
    'scheduler.drainQueue()',
  ].join('\n')
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childCode], { encoding: 'utf8', timeout: 10000 })
  assert.equal(child.status, 73, child.stderr)
  const db = openWorkbenchDb({ dbPath })
  recoveryDb = db
  const domain = new WorkbenchDomain(db)
  const scheduler = new TaskScheduler(domain, async () => {
    appendFileSync(effectPath, 'duplicate\n')
    return { state: 'completed', summary: 'unsafe duplicate' }
  })
  const [original] = domain.listRuns()
  assert.equal(original.state, 'unknown')
  const replay = await scheduler.dispatchBatch(['task'], 'crash')
  assert.equal(replay[0].id, original.id)
  await assert.rejects(scheduler.dispatchBatch(['task'], 'different-key'), e => e.code === 'UNKNOWN_OUTCOME')
  await sleep(20)
  assert.equal(readFileSync(effectPath, 'utf8'), 'once\n')
})

test('execution safety: stale terminal completion cannot overwrite a newer round', t => {
  const { domain, task } = setup(t)
  const old = domain.startRun({ taskId: task.id, clientRequestId: 'old' })
  domain.completeRun({ runId: old.id, state: 'interrupted', summary: 'confirmed exited', suggestedTaskStatus: 'todo' })
  const next = domain.startRun({ taskId: task.id, clientRequestId: 'next' })
  assert.throws(() => domain.completeRun({ runId: old.id, state: 'completed', summary: 'late result', suggestedTaskStatus: 'done' }))
  assert.equal(domain.getTask(task.id).statusCode, 'in_progress')
  assert.equal(domain.getRun(next.id).state, 'running')
})

test('execution safety: a cancelled queued request stays cancelled on retry, a new request can run', async t => {
  const { domain, p } = setup(t)
  const queuedTask = domain.createTask({ projectId: p.id, title: 'queued work' })
  let calls = 0
  const scheduler = new TaskScheduler(domain, async () => { calls++; return { state: 'completed', summary: 'ok' } },
    { maxGlobalConcurrency: 0 })
  const provider = new LocalProvider(domain, scheduler)
  const input = { taskId: queuedTask.id, clientRequestId: 'cancelled-key' }
  const first = await provider.startRun(input)
  const retry = await provider.startRun(input)
  assert.equal(retry.id, first.id)
  assert.equal(scheduler.getQueuedCount(), 1)
  await scheduler.stopRun(first.id)
  await assert.rejects(provider.startRun(input), e => e.code === 'CANCELLED')
  const next = await provider.startRun({ ...input, clientRequestId: 'new-work-key' })
  assert.notEqual(next.id, first.id)
  assert.equal(calls, 0)
  await scheduler.stopAll()
})

test('execution safety: queue persistence and cancellation failures cannot report success', async t => {
  const { domain, db, task } = setup(t)
  const scheduler = new TaskScheduler(domain, async () => assert.fail('must remain queued'), { maxGlobalConcurrency: 0 })
  const enqueue = domain.enqueueTask.bind(domain)
  domain.enqueueTask = () => { throw Error('disk unavailable') }
  await assert.rejects(scheduler.dispatchBatch([task.id], 'failed-write'), /disk unavailable/)
  assert.equal(scheduler.getQueuedCount(), 0)
  domain.enqueueTask = enqueue
  await scheduler.dispatchBatch([task.id], 'durable')
  db.exec("CREATE TRIGGER deny_cancel BEFORE UPDATE OF status ON task_queue WHEN NEW.status = 'cancelled' BEGIN SELECT RAISE(ABORT, 'disk readonly'); END")
  await assert.rejects(scheduler.stopAll(), /disk readonly/)
  assert.equal(scheduler.getQueuedCount(), 1)
  assert.equal(domain.listPendingQueue().length, 1)
  await assert.rejects(scheduler.stopRun(task.id), /disk readonly/)
  assert.equal(scheduler.getQueuedCount(), 1)
  db.exec('DROP TRIGGER deny_cancel')
  await scheduler.stopAll()
})

test('execution safety: a timed-out intent stop converges only when the actual worker exits', async t => {
  const { domain, p, task } = setup(t)
  let release
  const hold = new Promise(r => { release = r })
  const scheduler = new TaskScheduler(domain, async () => { await hold; return { state: 'completed', summary: 'late' } })
  const intent = domain.createWorkIntent('one operation', p.id)
  const [run] = await scheduler.dispatchBatch([task.id], 'intent', intent.id)
  const stop = await scheduler.stopIntent(intent.id, 5)
  assert.equal(stop.status, 'waiting_tool_exit')
  assert.equal(domain.getRun(run.id).state, 'stopping')
  assert.equal(domain.getWorkIntent(intent.id).status, 'stopping')
  release()
  await idle(scheduler)
  assert.equal(domain.getWorkIntent(intent.id).status, 'stopped')
  assert.equal(domain.getRun(run.id).state, 'interrupted')
  const next = await scheduler.dispatchBatch([task.id], 'new-round')
  assert.notEqual(next[0].id, run.id)
  await idle(scheduler)
})

test('execution safety: pre-fix single-task request keys remain replayable without execution', async t => {
  const { domain, task } = setup(t)
  const old = domain.startRun({ taskId: task.id, clientRequestId: 'old-client-' + task.id })
  domain.completeRun({ runId: old.id, state: 'completed', summary: 'earlier delivery' })
  const scheduler = new TaskScheduler(domain, async () => assert.fail('legacy replay must not execute'))
  const replay = await new LocalProvider(domain, scheduler).startRun({ taskId: task.id, clientRequestId: 'old-client' })
  assert.equal(replay.id, old.id)
})

test('packaged control feedback never claims a still-running or unknown worker has stopped', async () => {
  const { runInNewContext } = await import('node:vm')
  let client
  runInNewContext(readFileSync(resolve('lib/client.js'), 'utf8'), {
    window: { __ModuleLoader__: { load: definition => {
      client = definition.factory(name => name === 'react/jsx-runtime' ? {} : {})
    } } },
  })
  assert.equal(typeof client.formatStopFeedback, 'function')
  const feedback = status => client.formatStopFeedback({ commandId: 'test', status, stoppedRunIds: ['run'], pendingToolIds: ['run'] })
  assert.match(feedback('waiting_tool_exit'), /尚未确认停止/)
  assert.match(feedback('conflict'), /待核对/)
  assert.match(feedback('accepted'), /等待执行端确认/)
  assert.match(feedback('stopped'), /已确认目标工作停止/)
})
