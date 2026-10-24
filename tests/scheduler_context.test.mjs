import test from 'node:test'
import assert from 'node:assert/strict'
import { openWorkbenchDb } from '../lib/host/db/database.js'
import { WorkbenchDomain } from '../lib/host/services/domain.js'
import { TaskScheduler } from '../lib/host/services/scheduler.js'
import { WorkbenchContextManager } from '../lib/host/services/context.js'

test('Gate 3 & Gate 4 调度执行、同项目互斥与有界上下文测试', async (t) => {
  const db = openWorkbenchDb({ dbPath: ':memory:' })
  const domain = new WorkbenchDomain(db)

  // 1. 准备测试项目与任务
  const proj1 = domain.createProject({ id: 'p1', title: '电商系统', rootPath: 'C:\\Projects\\Shop' })
  const proj2 = domain.createProject({ id: 'p2', title: '营销系统', rootPath: 'C:\\Projects\\Marketing' })

  const t1 = domain.createTask({ id: 't1', projectId: 'p1', title: '支付接口' })
  const t2 = domain.createTask({ id: 't2', projectId: 'p1', title: '退款逻辑', dependencies: ['t1'] })
  const t3 = domain.createTask({ id: 't3', projectId: 'p1', title: '发票打印' })
  const t4 = domain.createTask({ id: 't4', projectId: 'p2', title: '优惠券发放' })

  await t.test('1. 调度器批量推进与同项目互斥控制', async () => {
    let mockExecutionResolve
    const mockExecutionPromise = new Promise((resolve) => {
      mockExecutionResolve = resolve
    })

    // 创建调度器：全局并发 2，同项目不允许并行（默认串行互斥）
    const scheduler = new TaskScheduler(
      domain,
      async (task) => {
        // 模拟异步任务持续运行
        if (task.id === 't1') {
          await mockExecutionPromise
        }
        return {
          state: 'completed',
          summary: `Task ${task.title} executed successfully`,
          artifactRefs: [{ title: 'patch.diff', path: 'dist/patch.diff' }],
          suggestedTaskStatus: 'done',
        }
      },
      { maxGlobalConcurrency: 2, allowSameProjectParallel: false },
    )

    // 尝试批量推进 t1, t2, t3, t4：
    // - t1 (p1): 就绪，开工
    // - t2 (p1): 依赖 t1 (未完成)，跳过
    // - t3 (p1): 虽然无依赖，但与 t1 同属 p1，同项目互斥，跳过
    // - t4 (p2): 属 p2，无依赖，开工
    const runs = await scheduler.dispatchBatch(['t1', 't2', 't3', 't4'], 'batch-001')
    assert.equal(runs.length, 2)
    assert.equal(runs[0].taskId, 't1')
    assert.equal(runs[1].taskId, 't4')

    // 检查活跃运行中个数为 1（t4 异步立即完成，t1 仍在等待 mockExecutionResolve）
    assert.equal(scheduler.getActiveRunCount(), 1)

    // 唤醒并结束 t1 执行
    mockExecutionResolve()
    // 等待微任务与队列自动推进完成 (drainQueue 会自动触发依赖已满足且同项目互斥解除的 t2, 随后推进 t3)
    await new Promise((r) => setTimeout(r, 80))

    // 此时 t1 已完成
    const t1After = domain.getTask('t1')
    assert.equal(t1After.statusCode, 'done')

    // 验证队列自动推进机制 (drainQueue)：t2 依赖满足后自动被调度并完成
    const t2After = domain.getTask('t2')
    assert.equal(t2After.statusCode, 'done')
    const t3After = domain.getTask('t3')
    assert.equal(t3After.statusCode, 'done')
  })

  await t.test('2. 有界上下文组装与失效卡片防护', () => {
    const contextMgr = new WorkbenchContextManager(domain)

    // 仅引用 t1
    const ctxText = contextMgr.buildBoundedContext('p1', ['t1', 'invalid-task-id'])
    // 主助理回复会直接引用上下文内容；必须明确要求它不要把内部 ID/状态码复述给用户
    assert.ok(
      ctxText.includes('绝不原样复述给用户'),
      '上下文必须包含“内部 ID/状态码不得复述给用户”的表达约束',
    )

    // 验证包含焦点项目和概要
    assert(ctxText.includes('【DSH 工作台主助理】'))
    assert(ctxText.includes('电商系统'))
    assert(ctxText.includes('(当前聚焦)'))

    // 验证引用的 t1 详情展开
    assert(ctxText.includes('任务卡 [支付接口]'))
    assert(ctxText.includes('Rev: ' + domain.getTask('t1').revision), '上下文引用必须对应真实最新 Revision')

    // 验证无效引用不瞎猜相近卡片，而是明确标注失效
    assert(ctxText.includes('任务卡引用失效 (ID: invalid-task-id 未找到)'))

    // 验证未引用的 t4 详细验收标准不会被灌入上下文
    assert(!ctxText.includes('优惠券发放详情'))
  })

  await t.test('3. 会话轮换', async () => {
    const contextMgr = new WorkbenchContextManager(domain)
    // rotateSession 自 20261023-1636 轮起支持异步宿主 Session 验证器，故为 async
    const rotated = await contextMgr.rotateSession('main-assistant')
    assert.equal(rotated.generation, 2)
  })
})
