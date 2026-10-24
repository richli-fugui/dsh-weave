import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { openWorkbenchDb } from '../lib/host/db/database.js'
import { WorkbenchDomain } from '../lib/host/services/domain.js'
import { TaskScheduler } from '../lib/host/services/scheduler.js'
import { LocalProvider } from '../lib/providers/local.js'
import { apply } from '../lib/index.js'
import { WorkbenchError, ValidationError } from '../lib/shared/errors.js'

test('T-012: 自动查询/停止/恢复对账与 unknown 保护解除专项验证', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-t012-'))
  t.after(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  await t.test('1. 严禁凭用户改卡或文件存在静默解除 unknown 保护；改卡为 todo 必须硬报错', async () => {
    const dbPath = path.join(tempDir, 't012_guard.sqlite')
    const db = openWorkbenchDb({ dbPath })
    const domain = new WorkbenchDomain(db)

    const proj = domain.createProject({ id: 'p-guard', title: 'Guard Proj', rootPath: tempDir })
    const task = domain.createTask({ id: 't-guard', projectId: proj.id, title: 'Task Guard' })
    const run = domain.startRun({ taskId: task.id, clientRequestId: 'req-guard-1' })

    // 模拟进程崩溃重启
    domain.reconcileCrashedRunsOnStartup()

    const taskBlocked = domain.getTask(task.id)
    assert.equal(taskBlocked.statusCode, 'blocked', '重启后未决任务必须为 blocked')
    const runUnknown = domain.getRun(run.id)
    assert.equal(runUnknown.state, 'unknown', '重启后未决 Run 必须为 unknown')
    assert.equal(domain.hasUncertainProject(proj.id), true, '项目保护必须处于生效状态')

    // 规则验证：即使工作区出现成果文件，保护也绝不能静默解除
    const fakeArtifact = path.join(tempDir, 'fake-result.md')
    fs.writeFileSync(fakeArtifact, 'fake output')
    assert.equal(domain.hasUncertainProject(proj.id), true, '仅凭物理文件存在绝不能解除 unknown 保护')

    // 规则验证：试图直接调用 updateTask 把 blocked 改为 todo，必须硬报错拒收，禁止绕过对账
    await assert.rejects(
      async () => {
        domain.updateTask({ id: task.id, expectedRevision: taskBlocked.revision, statusCode: 'todo' })
      },
      (err) => err instanceof WorkbenchError && err.code === 'UNKNOWN_OUTCOME',
      '未完成对账前，手动将 blocked 卡片置为 todo 必须抛出 UNKNOWN_OUTCOME 拒绝',
    )
  })

  await t.test('2. 显式对账中断：确认 Worker 退出后，原子解除 unknown 保护并安全重置为 todo', async () => {
    const dbPath = path.join(tempDir, 't012_interrupted.sqlite')
    const db = openWorkbenchDb({ dbPath })
    const domain = new WorkbenchDomain(db)

    const proj = domain.createProject({ id: 'p-int', title: 'Int Proj', rootPath: tempDir })
    const task = domain.createTask({ id: 't-int', projectId: proj.id, title: 'Task Int' })
    const run = domain.startRun({ taskId: task.id, clientRequestId: 'req-int-1' })

    domain.reconcileCrashedRunsOnStartup()
    assert.equal(domain.hasUncertainProject(proj.id), true)

    // 对账为 interrupted
    const rec = domain.reconcileUnknownRun(run.id, {
      state: 'interrupted',
      summary: 'Host confirmed worker process terminated without output',
    })
    assert.equal(rec.run.state, 'interrupted')
    assert.ok(rec.run.finishedAt)
    assert.equal(rec.run.outcome?.reconciliationSummary, 'Host confirmed worker process terminated without output')

    // 任务自动解阻为 todo
    const taskAfter = domain.getTask(task.id)
    assert.equal(taskAfter.statusCode, 'todo', '对账中断后任务应安全恢复为 todo')
    assert.equal(domain.hasUncertainProject(proj.id), false, '项目保护应解除')

    // 现在可以再次正常派发新一轮执行，不受阻断
    const nextRun = domain.startRun({ taskId: task.id, clientRequestId: 'req-int-2' })
    assert.equal(nextRun.state, 'running')
  })

  await t.test('3. 显式对账完成：确认 Worker 成功交付后，原子补齐 Result 并流转为 review', async () => {
    const dbPath = path.join(tempDir, 't012_completed.sqlite')
    const db = openWorkbenchDb({ dbPath })
    const domain = new WorkbenchDomain(db)

    const proj = domain.createProject({ id: 'p-comp', title: 'Comp Proj', rootPath: tempDir })
    const task = domain.createTask({ id: 't-comp', projectId: proj.id, title: 'Task Comp' })
    const run = domain.startRun({ taskId: task.id, clientRequestId: 'req-comp-1' })

    domain.reconcileCrashedRunsOnStartup()

    const rec = domain.reconcileUnknownRun(run.id, {
      state: 'completed',
      summary: 'Host confirmed task successfully generated deliverable',
      artifactRefs: [{ title: 'report.md', path: 'docs/report.md' }],
      suggestedTaskStatus: 'review',
    })
    assert.equal(rec.run.state, 'completed')
    assert.ok(rec.result)
    assert.equal(rec.result.summary, 'Host confirmed task successfully generated deliverable')
    assert.equal(rec.result.artifactRefs.length, 1)

    const taskAfter = domain.getTask(task.id)
    assert.equal(taskAfter.statusCode, 'review', '对账完成时任务流转为 review 待验收')
    assert.equal(domain.hasUncertainProject(proj.id), false)
  })

  await t.test('4. TaskScheduler 与 WorkerReconciler 联动：查询 Host 确认退出后自动对账并唤醒排队项', async () => {
    const dbPath = path.join(tempDir, 't012_scheduler.sqlite')
    const db = openWorkbenchDb({ dbPath })
    const domain = new WorkbenchDomain(db)

    const proj = domain.createProject({ id: 'p-sched', title: 'Sched Proj', rootPath: tempDir })
    const taskA = domain.createTask({ id: 't-sched-a', projectId: proj.id, title: 'Task A' })
    const taskB = domain.createTask({ id: 't-sched-b', projectId: proj.id, title: 'Task B' })

    // 先启动 A，并在队列排队 B
    domain.startRun({ taskId: taskA.id, clientRequestId: 'req-sa-1' })
    domain.enqueueTask({
      id: 'q-sb',
      taskId: taskB.id,
      clientRequestId: 'req-sb-1',
      taskTitle: taskB.title,
      projectId: proj.id,
      controlEpoch: 0,
    })

    // 崩溃重启：A 变为 unknown，B 仍在队列
    domain.reconcileCrashedRunsOnStartup()
    assert.equal(domain.hasUncertainProject(proj.id), true)

    // 创建模拟的 Host 状态查询器
    let queryCount = 0
    let hostWorkerState = 'running'
    const workerReconciler = async (info) => {
      queryCount++
      assert.equal(info.taskId, taskA.id)
      return {
        state: hostWorkerState,
        summary: `Worker is currently ${hostWorkerState}`,
      }
    }

    let bExecuted = false
    const mockExecutor = async (t) => {
      if (t.id === taskB.id) bExecuted = true
      return { state: 'completed', summary: 'done' }
    }

    const scheduler = new TaskScheduler(domain, mockExecutor, {
      workerReconciler,
      maxGlobalConcurrency: 2,
    })

    // 阶段 1：Host 报告 Worker 依然在运行中 -> 必须保留保护，不能提前解除，B 不能调度
    const check1 = await scheduler.reconcileUncertainRuns()
    assert.equal(check1.reconciled.length, 0)
    assert.equal(check1.stillUncertain.length, 1)
    assert.equal(domain.hasUncertainProject(proj.id), true)
    assert.equal(bExecuted, false, 'Worker 仍在运行时，排队任务 B 绝对不可调度')

    // 阶段 2：Host 确认 Worker 已经退出 (exited) -> 自动对账为 interrupted，保护解除，并自动唤醒 B 调度！
    hostWorkerState = 'exited'
    const check2 = await scheduler.reconcileUncertainRuns()
    assert.equal(check2.reconciled.length, 1)
    assert.equal(check2.reconciled[0].resolvedState, 'interrupted')
    assert.equal(check2.stillUncertain.length, 0)
    assert.equal(domain.hasUncertainProject(proj.id), false)

    // 等待 microtask 和调度流转
    await new Promise((r) => setTimeout(r, 80))
    assert.equal(bExecuted, true, '解除保护后排队任务 B 成功被唤醒并执行')
  })

  await t.test('5. 端到端 WebServer 控制接口：/api/workbench/control/uncertain 与 reconcile 闭环', async () => {
    const dbPath = path.join(tempDir, 't012_routes.sqlite')
    const db = openWorkbenchDb({ dbPath })
    const domain = new WorkbenchDomain(db)

    const proj = domain.createProject({ id: 'p-route', title: 'Route Proj', rootPath: tempDir })
    const task = domain.createTask({ id: 't-route', projectId: proj.id, title: 'Task Route' })
    const run = domain.startRun({ taskId: task.id, clientRequestId: 'req-route-1' })

    domain.reconcileCrashedRunsOnStartup()

    const routes = new Map()
    const mockCtx = {
      webServer: { get: (p, h) => routes.set('GET ' + p, h), post: (p, h) => routes.set('POST ' + p, h) },
      systemPrompt: { addSection: () => {} },
      tools: { register: () => {} },
    }

    apply(mockCtx, { dbPath })

    const getUncertainHandler = routes.get('GET /api/workbench/control/uncertain')
    const postReconcileHandler = routes.get('POST /api/workbench/control/reconcile')
    assert.ok(getUncertainHandler)
    assert.ok(postReconcileHandler)

    // 查询未决执行
    let uncertData = null
    await getUncertainHandler({}, { json: (d) => { uncertData = d } })
    assert.ok(uncertData)
    assert.equal(uncertData.runs.length, 1)
    assert.equal(uncertData.runs[0].id, run.id)

    // 执行对账
    let recResult = null
    await postReconcileHandler(
      {
        body: {
          runId: run.id,
          resolution: {
            state: 'interrupted',
            summary: 'Operator confirmed via control route',
          },
        },
      },
      { json: (d) => { recResult = d } },
    )

    assert.ok(recResult)
    assert.equal(recResult.run.state, 'interrupted')
    const taskAfter = domain.getTask(task.id)
    assert.equal(taskAfter.statusCode, 'todo')
    assert.equal(domain.hasUncertainProject(proj.id), false)
  })
})
