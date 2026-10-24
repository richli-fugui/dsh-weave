import test from 'node:test'
import assert from 'node:assert/strict'
import { openWorkbenchDb } from '../lib/host/db/database.js'
import { WorkbenchDomain } from '../lib/host/services/domain.js'
import { RemoteProvider } from '../lib/providers/remote.js'
import { WorkbenchError } from '../lib/shared/errors.js'

test('Gate 5 RemoteProvider 协议与 Stub 联调测试', async (t) => {
  const db = openWorkbenchDb({ dbPath: ':memory:' })
  const domain = new WorkbenchDomain(db)

  // 创建一个连接到 Windows 远端 Domain 的 Stub 适配器
  let readyState = true
  const stubAdapter = {
    connectionId: 'conn-win-desktop-01',
    isReady: () => readyState,
    async invoke(endpoint, payload) {
      if (endpoint === 'workbench.projects.create') {
        return domain.createProject(payload)
      } else if (endpoint === 'workbench.projects.list') {
        return domain.listProjects()
      } else if (endpoint === 'workbench.tasks.create') {
        return domain.createTask(payload)
      } else if (endpoint === 'workbench.tasks.list') {
        return domain.listTasks(payload?.projectId)
      } else if (endpoint === 'workbench.runs.start') {
        return domain.startRun(payload)
      } else if (endpoint === 'workbench.runs.complete') {
        return domain.completeRun(payload)
      } else {
        throw new Error(`Unknown endpoint: ${endpoint}`)
      }
    },
    follow(endpoint, payload, onData) {
      return domain.listOutboxEvents(payload.afterSequence).forEach(onData)
    },
  }

  const remoteProvider = new RemoteProvider(stubAdapter)

  await t.test('1. Mac 端通过 RemoteProvider 创建项目与任务 (数据权威在 Windows)', async () => {
    const proj = await remoteProvider.createProject({
      id: 'mac-remote-proj',
      title: '远端联调项目',
      rootPath: 'C:\\Projects\\RemoteProj',
      goal: 'Mac 界面发起，Windows 权威落地',
    })
    assert.equal(proj.id, 'mac-remote-proj')

    const task = await remoteProvider.createTask({
      id: 'mac-remote-task',
      projectId: 'mac-remote-proj',
      title: '编译远程模块',
    })
    assert.equal(task.id, 'mac-remote-task')

    // 验证 Windows 本地数据库真实落盘了相同记录
    const winTask = domain.getTask('mac-remote-task')
    assert.equal(winTask.title, '编译远程模块')
  })

  await t.test('2. 远程推进任务与状态回传', async () => {
    const run = await remoteProvider.startRun({
      taskId: 'mac-remote-task',
      clientRequestId: 'mac-req-001',
    })
    assert.equal(run.state, 'running')

    const comp = await remoteProvider.completeRun({
      runId: run.id,
      state: 'completed',
      summary: 'Windows 已经完成编译并输出二进制',
      artifactRefs: [{ title: 'build.exe', path: 'bin/build.exe' }],
      suggestedTaskStatus: 'done',
    })
    assert.equal(comp.run.state, 'completed')

    // 验证 Windows 端 task 状态更新
    const taskAfter = domain.getTask('mac-remote-task')
    assert.equal(taskAfter.statusCode, 'done')
  })

  await t.test('3. 离线/断网时明确阻塞，绝不在 Mac 本地静默创建同名执行', async () => {
    readyState = false

    await assert.rejects(
      async () => {
        await remoteProvider.createTask({
          projectId: 'mac-remote-proj',
          title: '离线任务',
        })
      },
      (err) => {
        assert(err instanceof WorkbenchError)
        assert.equal(err.code, 'OFFLINE')
        return true
      },
    )
  })
})
