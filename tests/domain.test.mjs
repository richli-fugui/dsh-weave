import test from 'node:test'
import assert from 'node:assert/strict'
import { openWorkbenchDb } from '../lib/host/db/database.js'
import { WorkbenchDomain } from '../lib/host/services/domain.js'
import { LocalProvider } from '../lib/providers/local.js'
import { ConflictError, CircularDependencyError, ValidationError } from '../lib/shared/errors.js'

test('Gate 1 Domain & LocalProvider 完整闭环测试', async (t) => {
  // 使用内存 SQLite 数据库进行测试
  const db = openWorkbenchDb({ dbPath: ':memory:' })
  const domain = new WorkbenchDomain(db)
  const provider = new LocalProvider(domain)

  await t.test('1. 创建并读取项目', async () => {
    const project = await provider.createProject({
      id: 'proj-1',
      title: '测试系统',
      rootPath: 'C:\\Projects\\test-project',
      goal: '验证工作台能力',
    })

    assert.equal(project.id, 'proj-1')
    assert.equal(project.title, '测试系统')
    assert.equal(project.revision, 1)

    const list = await provider.listProjects()
    assert.equal(list.length, 1)
    assert.equal(list[0].id, 'proj-1')
  })

  await t.test('2. CAS 并发冲突控制 (Projects)', async () => {
    // 正确 revision 更新
    const updated = await provider.updateProject({
      id: 'proj-1',
      title: '测试系统 (已重命名)',
      expectedRevision: 1,
    })
    assert.equal(updated.title, '测试系统 (已重命名)')
    assert.equal(updated.revision, 2)

    // 冲突 revision 更新（仍使用旧 revision 1）
    await assert.rejects(
      async () => {
        await provider.updateProject({
          id: 'proj-1',
          title: '并发冲突标题',
          expectedRevision: 1,
        })
      },
      (err) => {
        assert(err instanceof ConflictError)
        return true
      },
    )
  })

  await t.test('3. 创建任务与无环依赖校验', async () => {
    const tA = await provider.createTask({
      id: 'task-a',
      projectId: 'proj-1',
      title: '任务 A (前置任务)',
    })
    assert.equal(tA.id, 'task-a')
    assert.equal(tA.revision, 1)

    const tB = await provider.createTask({
      id: 'task-b',
      projectId: 'proj-1',
      title: '任务 B (依赖 A)',
      dependencies: ['task-a'],
    })
    assert.deepEqual(tB.dependencies, ['task-a'])

    // 测试环形依赖阻断：创建或更新任务 A 依赖 B (形成 A -> B -> A 环)
    await assert.rejects(
      async () => {
        await provider.updateTask({
          id: 'task-a',
          expectedRevision: 1,
          dependencies: ['task-b'],
        })
      },
      (err) => {
        assert(err instanceof CircularDependencyError)
        return true
      },
    )
  })

  await t.test('4. Run 调度执行与依赖阻断', async () => {
    // 任务 B 依赖 A，但任务 A 尚未完成（当前为 todo），直接派发 B 必须被拒绝
    await assert.rejects(
      async () => {
        await provider.startRun({
          taskId: 'task-b',
          clientRequestId: 'req-b-1',
        })
      },
      (err) => {
        assert(err instanceof ValidationError)
        assert(err.message.includes('not done'))
        return true
      },
    )

    // 先启动任务 A 的 Run
    const runA = await provider.startRun({
      taskId: 'task-a',
      clientRequestId: 'req-a-1',
    })
    assert.equal(runA.state, 'running')
    assert.equal(runA.taskId, 'task-a')

    // 幂等测试：重复提交相同 clientRequestId，必须返回同一个 Run，不重复创建
    const runAIdempotent = await provider.startRun({
      taskId: 'task-a',
      clientRequestId: 'req-a-1',
    })
    assert.equal(runAIdempotent.id, runA.id)

    // 完成任务 A 的 Run 并验收通过
    const completeRes = await provider.completeRun({
      runId: runA.id,
      state: 'completed',
      summary: '任务 A 代码已经提交并通过测试',
      artifactRefs: [{ title: 'index.ts', path: 'src/index.ts' }],
      suggestedTaskStatus: 'done',
    })
    assert.equal(completeRes.run.state, 'completed')
    assert.equal(completeRes.result.summary, '任务 A 代码已经提交并通过测试')

    const taskAAfter = await provider.getTask('task-a')
    assert.equal(taskAAfter.statusCode, 'done')

    // 此时任务 A 已 done，任务 B 的依赖已满足，成功派发 B
    const runB = await provider.startRun({
      taskId: 'task-b',
      clientRequestId: 'req-b-2',
    })
    assert.equal(runB.state, 'running')
  })

  await t.test('5. Outbox 事件流追赶与主助理 Session 轮换', async () => {
    // 检查 Outbox 产生的连续事件
    const events = domain.listOutboxEvents(0, 50)
    assert(events.length >= 4)
    assert(events[0].sequence < events[1].sequence)

    // 主助理状态与轮换
    const assistant = await provider.getAssistantState('main-assistant')
    assert.equal(assistant.generation, 1)

    const rotated = await provider.rotateAssistantSession('main-assistant')
    assert.equal(rotated.generation, 2)
    assert.notEqual(rotated.currentSessionId, assistant.currentSessionId)

    // 验证轮换事件已写入 Outbox
    const latestEvents = domain.listOutboxEvents(events[events.length - 1].sequence, 10)
    const rotateEv = latestEvents.find((e) => e.type === 'assistant.rotated')
    assert(rotateEv)
    assert.equal(rotateEv.payload.generation, 2)
  })
})
