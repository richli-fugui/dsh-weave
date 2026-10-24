import test from 'node:test'
import assert from 'node:assert/strict'
import { openWorkbenchDb } from '../lib/host/db/database.js'
import { WorkbenchDomain } from '../lib/host/services/domain.js'
import { TaskScheduler } from '../lib/host/services/scheduler.js'
import { WorkbenchContextManager } from '../lib/host/services/context.js'

test('L1 自动化验证规格用例 (STOP 核心与鲁棒性验证)', async (t) => {
  // 每个测试套件使用隔离内存数据库
  const db = openWorkbenchDb({ dbPath: ':memory:' })
  const domain = new WorkbenchDomain(db)

  // 准备标准测试项目
  const p1 = domain.createProject({
    title: '自动化验证项目-Alpha',
    rootPath: 'C:\\test\\workbench-alpha',
    goal: '验证控制路径、并发与停止语义',
  })
  const p2 = domain.createProject({
    title: '自动化验证项目-Beta',
    rootPath: 'C:\\test\\workbench-beta',
    goal: '验证多项目隔离',
  })

  await t.test('STOP-001: 主助理 idle 状态下发起全局/空目标停止', async () => {
    const scheduler = new TaskScheduler(domain, async () => {})
    // 当没有任何任务运行时
    assert.equal(scheduler.getActiveRunCount(), 0)
    assert.equal(scheduler.getQueuedCount(), 0)

    const stopResult = await scheduler.stopAll()
    assert.equal(stopResult.status, 'stopped')
    assert.equal(stopResult.stoppedRunIds.length, 0)

    const snapshot = scheduler.getControlSnapshot()
    assert.equal(snapshot.activeCount, 0)
    assert.equal(snapshot.queuedCount, 0)
  })

  await t.test('STOP-003: 停止已排队未启动的任务', async () => {
    // 创建两个同项目任务（p1 互斥串行）
    const tA = domain.createTask({
      projectId: p1.id,
      title: '正在运行的任务 A',
      goal: '占用 p1 槽位',
      acceptance: 'A 完成',
    })
    const tB = domain.createTask({
      projectId: p1.id,
      title: '等待排队的任务 B',
      goal: '因同项目互斥在队列中等待',
      acceptance: 'B 完成',
    })

    let holdResolve
    const holdPromise = new Promise((r) => {
      holdResolve = r
    })

    const scheduler = new TaskScheduler(
      domain,
      async (task) => {
        if (task.id === tA.id) {
          await holdPromise
        }
      },
      { maxGlobalConcurrency: 2, allowSameProjectParallel: false },
    )

    // 批量派发 tA 和 tB：tA 进入 activeRuns，tB 进入 queuedItems
    await scheduler.dispatchBatch([tA.id, tB.id], 'batch-stop-003')
    assert.equal(scheduler.getActiveRunCount(), 1)
    assert.equal(scheduler.getQueuedCount(), 1)

    // 在 tB 启动前，对 tB 发起停止 (通过 taskId 停止队列项)
    const stopRes = await scheduler.stopRun(tB.id)
    assert.equal(stopRes.status, 'stopped')
    assert.equal(scheduler.getQueuedCount(), 0, '排队项应已被移出队列')

    // 释放 tA
    holdResolve()
    await new Promise((r) => setTimeout(r, 60))

    // 检查 tA 完成，而 tB 绝不能被自动派发
    const tBAfter = domain.getTask(tB.id)
    assert.notEqual(tBAfter.statusCode, 'in_progress', '被停止的排队任务不应进入 running')
    assert.equal(scheduler.getActiveRunCount(), 0)
  })

  await t.test('STOP-006: 可取消工具/Worker 中途停止，信号收敛且状态标记 cancelled', async () => {
    const tWorker = domain.createTask({
      projectId: p2.id,
      title: '可取消工作任务',
      goal: '模拟可响应中断信号的长任务',
      acceptance: '可中断',
    })

    let workerAborted = false
    let workerStarted = false
    let resolveWorker

    const scheduler = new TaskScheduler(
      domain,
      async (_task, _run, abortSignal) => {
        workerStarted = true
        return new Promise((resolve, reject) => {
          resolveWorker = resolve
          abortSignal.addEventListener('abort', () => {
            workerAborted = true
            reject(new Error('Operation aborted by user'))
          })
        })
      },
    )

    const runs = await scheduler.dispatchBatch([tWorker.id], 'batch-stop-006')
    assert.equal(runs.length, 1)
    const runId = runs[0].id

    // 等待 worker 启动
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(workerStarted, true)

    // 发起独立停止
    const stopRes = await scheduler.stopRun(runId)
    assert.ok(['stopped', 'stopping'].includes(stopRes.status))
    assert.equal(stopRes.stoppedRunIds[0], runId)

    // 等待中断信号传递
    await new Promise((r) => setTimeout(r, 50))
    assert.equal(workerAborted, true, 'AbortSignal 必须触发')
    assert.equal(scheduler.getActiveRunCount(), 0, '活跃运行数归零')

    // 检查任务状态不为 done
    const taskAfter = domain.getTask(tWorker.id)
    assert.notEqual(taskAfter.statusCode, 'done', '中断的任务绝不能被标记为 done')
  })

  await t.test('STOP-011: 多任务并行中只停 A 保留 B', async () => {
    const tA = domain.createTask({
      projectId: p1.id,
      title: '任务 A',
      goal: '将被停止',
      acceptance: 'A',
    })
    const tB = domain.createTask({
      projectId: p2.id, // 不同项目，允许并行
      title: '任务 B',
      goal: '将不受影响继续执行',
      acceptance: 'B',
    })

    let aAborted = false
    let bCompleted = false
    let bResolve

    const scheduler = new TaskScheduler(
      domain,
      async (task, _run, abortSignal) => {
        if (task.id === tA.id) {
          return new Promise((_, reject) => {
            abortSignal.addEventListener('abort', () => {
              aAborted = true
              reject(new Error('A aborted'))
            })
          })
        }
        if (task.id === tB.id) {
          return new Promise((resolve) => {
            bResolve = () => {
              bCompleted = true
              resolve({
                state: 'completed',
                summary: 'B completed normally',
                suggestedTaskStatus: 'done',
              })
            }
          })
        }
      },
      { maxGlobalConcurrency: 4, allowSameProjectParallel: false },
    )

    const runs = await scheduler.dispatchBatch([tA.id, tB.id], 'batch-stop-011')
    assert.equal(runs.length, 2)
    const runA = runs.find((r) => r.taskId === tA.id)
    const runB = runs.find((r) => r.taskId === tB.id)

    // 仅停止任务 A
    const stopRes = await scheduler.stopRun(runA.id)
    assert.deepEqual(stopRes.stoppedRunIds, [runA.id])

    await new Promise((r) => setTimeout(r, 30))
    assert.equal(aAborted, true, '任务 A 收到中断信号')

    // 检查任务 B 仍处于 activeRuns 中且未被取消
    assert.equal(scheduler.isRunActive(runB.id), true, '任务 B 仍正常运行')

    // 唤醒任务 B 正常完成
    bResolve()
    await new Promise((r) => setTimeout(r, 50))
    assert.equal(bCompleted, true, '任务 B 成功执行完毕')

    const tBAfter = domain.getTask(tB.id)
    assert.equal(tBAfter.statusCode, 'done', '任务 B 正常更新为 done')
  })

  await t.test('STOP-013 & STOP-014: 停止全部工作台工作并防止迟到幽灵派发', async () => {
    const t1 = domain.createTask({ projectId: p1.id, title: '全停任务 1', goal: 'G1', acceptance: 'A1' })
    const t2 = domain.createTask({ projectId: p2.id, title: '全停任务 2', goal: 'G2', acceptance: 'A2' })
    const t3 = domain.createTask({ projectId: p1.id, title: '全停排队 3', goal: 'G3', acceptance: 'A3' })

    const scheduler = new TaskScheduler(
      domain,
      async (_task, _run, abortSignal) => {
        return new Promise((_, reject) => {
          abortSignal.addEventListener('abort', () => reject(new Error('Stopped by stopAll')))
        })
      },
      { maxGlobalConcurrency: 2, allowSameProjectParallel: false },
    )

    await scheduler.dispatchBatch([t1.id, t2.id, t3.id], 'batch-stop-all')
    assert.equal(scheduler.getActiveRunCount(), 2)
    assert.equal(scheduler.getQueuedCount(), 1)

    // 执行全局停止
    const res = await scheduler.stopAll()
    assert.equal(res.status, 'stopped')
    assert.equal(res.stoppedRunIds.length, 2, '所有正在运行的任务均被中断')
    assert.equal(scheduler.getQueuedCount(), 0, '排队队列清空')

    await new Promise((r) => setTimeout(r, 40))
    assert.equal(scheduler.getActiveRunCount(), 0, '全部运行退出')

    // 验证排队的 t3 绝不会在之后幽灵启动
    const t3After = domain.getTask(t3.id)
    assert.notEqual(t3After.statusCode, 'in_progress')
    assert.notEqual(t3After.statusCode, 'done')
  })

  await t.test('STOP-015: 重复停止幂等性测试', async () => {
    const scheduler = new TaskScheduler(domain, async () => {})
    const res1 = await scheduler.stopAll()
    assert.equal(res1.status, 'stopped')

    // 连续二次调用，不应抛出异常
    const res2 = await scheduler.stopAll()
    assert.equal(res2.status, 'stopped')
    assert.equal(res2.stoppedRunIds.length, 0)
  })

  await t.test('STOP-021: 停止工作不删除任务卡与物理项目记录', async () => {
    const tCard = domain.createTask({
      projectId: p1.id,
      title: '核心资产保护卡',
      goal: '停止操作不得误删此卡',
      acceptance: '卡片留存',
    })

    const scheduler = new TaskScheduler(
      domain,
      async (_task, _run, abortSignal) => {
        return new Promise((_, reject) => {
          abortSignal.addEventListener('abort', () => reject(new Error('Aborted')))
        })
      },
    )

    const runs = await scheduler.dispatchBatch([tCard.id], 'batch-stop-021')
    await scheduler.stopRun(runs[0].id)
    await new Promise((r) => setTimeout(r, 40))

    // 验证卡片依然完整存在于数据库
    const persistedTask = domain.getTask(tCard.id)
    assert.equal(persistedTask.id, tCard.id)
    assert.equal(persistedTask.title, '核心资产保护卡')
    assert.notEqual(persistedTask.statusCode, 'done')

    // 验证项目依然存在
    const persistedProj = domain.getProject(p1.id)
    assert.equal(persistedProj.id, p1.id)
  })

  await t.test('MUTATION-001: 变异防护测试 (防假停止：强制验证 controlEpoch 递增与信号传递)', async () => {
    const scheduler = new TaskScheduler(domain, async () => {})
    const epochBefore = scheduler.getControlEpoch()

    await scheduler.stopAll()
    const epochAfter = scheduler.getControlEpoch()
    assert.equal(epochAfter, epochBefore + 1, '每次 Stop 控制必须单调递增 controlEpoch 防范迟到派单')
  })
})
