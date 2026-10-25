import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { openWorkbenchDb } from '../lib/host/db/database.js'
import { WorkbenchDomain } from '../lib/host/services/domain.js'
import { TaskScheduler } from '../lib/host/services/scheduler.js'
import { WorkbenchContextManager } from '../lib/host/services/context.js'
import { LocalProvider } from '../lib/providers/local.js'
import { apply as applyWorkbench } from '../lib/index.js'

test('工作台全链路控制与自主维护 E2E 专项验证', async (t) => {
  // UNIT/MOCK only: ordinary regression must never read local credentials or call a real model.
  const stubBodies = []
  const bridge = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [] }))
    if (req.url !== '/v1/chat/completions') { res.statusCode = 404; return res.end('{}') }
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      stubBodies.push(JSON.parse(body))
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content:
        '隔离替身回复：这是一份用于验证工作区写入、历史版本保存与消息持久化的固定测试材料。它不代表真实模型能力，不证明自然语言理解或办公成果已完成。' } }] }))
    })
  })
  await new Promise(resolve => bridge.listen(0, '127.0.0.1', resolve))
  t.after(() => { bridge.closeAllConnections(); bridge.close() })
  const apply = (ctx, config) => applyWorkbench(ctx, {
    ...config, aiApiKey: 'isolated-regression-key', aiModel: 'test-stub',
    aiBaseURL: 'http://127.0.0.1:' + bridge.address().port + '/v1',
  })

  // 创建临时隔离工作区目录用于测试物理副作用落盘
  const tempWorkspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-e2e-'))

  // 种子项目的默认根目录必须指向临时隔离目录：回归测试不得向用户真实 ~/.dsh/workbench/workspace 写入
  const prevDefaultRoot = process.env.DSH_WORKBENCH_DEFAULT_ROOT
  process.env.DSH_WORKBENCH_DEFAULT_ROOT = tempWorkspaceDir

  t.after(() => {
    if (prevDefaultRoot === undefined) delete process.env.DSH_WORKBENCH_DEFAULT_ROOT
    else process.env.DSH_WORKBENCH_DEFAULT_ROOT = prevDefaultRoot
    try {
      fs.rmSync(tempWorkspaceDir, { recursive: true, force: true })
    } catch {}
  })

  // 1. 主助理回合结束而后台仍运行 (Decoupled Lifecycle & Physical Artifact)
  await t.test('1. 主助理回合结束而后台仍运行，后台独立产出实际成果物与证据文件', async () => {
    const db = openWorkbenchDb({ dbPath: ':memory:' })
    const domain = new WorkbenchDomain(db)

    const proj = domain.createProject({
      title: '主助理生命周期解耦项目',
      rootPath: tempWorkspaceDir,
      goal: '验证后台独立执行与副作用落盘',
    })

    const task = domain.createTask({
      projectId: proj.id,
      title: '数据清洗与整理任务',
      goal: '产出清洗报告与统计结果',
      acceptance: '工件 JSON 文件必须存在且状态为 review_pending',
    })

    let finishWorkerExecution
    const workerFinishPromise = new Promise((resolve) => {
      finishWorkerExecution = resolve
    })

    // 真实 Worker 模拟：在 projectRoot 写入 .workbench/<task.id>-result.json
    const scheduler = new TaskScheduler(domain, async (t, rootPath, signal) => {
      // 等待外部信号，模拟后台耗时作业
      await workerFinishPromise

      if (signal.aborted) {
        return { state: 'interrupted', summary: '用户终止', suggestedTaskStatus: 'todo' }
      }

      const wbDir = path.join(rootPath, '.workbench')
      fs.mkdirSync(wbDir, { recursive: true })
      const artifactPath = path.join(wbDir, `${t.id}-result.json`)
      fs.writeFileSync(
        artifactPath,
        JSON.stringify({
          taskId: t.id,
          executedAt: new Date().toISOString(),
          status: 'review_pending',
          recordsProcessed: 100,
        }),
      )

      return {
        state: 'completed',
        summary: `完成任务 [${t.title}]，已生成成果`,
        artifactRefs: [{ title: t.title, path: artifactPath, kind: 'json' }],
        evidenceRefs: [artifactPath],
        suggestedTaskStatus: 'review',
      }
    })

    const provider = new LocalProvider(domain, scheduler)

    // 模拟主助理聊天发送与推进意图（主回合立即返回）
    const intent = await provider.createWorkIntent('请推进数据清洗任务', proj.id)
    const runs = await scheduler.dispatchBatch([task.id], 'req-decouple-01', intent.id)

    assert.equal(runs.length, 1, 'Run 应该已创建并开工')

    // 关键验证 1：主助理消息已回复（回合结束），但后台仍在运行
    const snapshot1 = await provider.getControlSnapshot()
    assert.equal(snapshot1.activeCount, 1, '后台应当有 1 项任务正在执行')
    assert.equal(snapshot1.items[0].taskId, task.id)
    assert.equal(snapshot1.items[0].state, 'running')

    // 关键验证 2：物理成果尚未生成（因为 worker 还在后台等待）
    const expectedArtifactPath = path.join(tempWorkspaceDir, '.workbench', `${task.id}-result.json`)
    assert.equal(fs.existsSync(expectedArtifactPath), false, '尚未执行结束时工件不应提前伪造')

    // 允许 Worker 结束
    finishWorkerExecution()
    await new Promise((r) => setTimeout(r, 60))

    // 关键验证 3：执行结束后，后台计数清零，物理文件真实落盘
    const snapshot2 = await provider.getControlSnapshot()
    assert.equal(snapshot2.activeCount, 0, 'Worker 执行完毕后 activeCount 恢复为 0')
    assert.equal(fs.existsSync(expectedArtifactPath), true, '真实物理工件必须落盘')

    const fileContent = JSON.parse(fs.readFileSync(expectedArtifactPath, 'utf-8'))
    assert.equal(fileContent.status, 'review_pending')
    assert.equal(fileContent.recordsProcessed, 100)

    // 任务状态规范：执行结束默认建议 review，不擅自宣称 done
    const updatedTask = domain.getTask(task.id)
    assert.equal(updatedTask.statusCode, 'review', '任务状态应推进到 review')
  })

  // 2. 变异防假停止：不响应取消的 worker -> 状态如实报告 waiting_tool_exit (Stubborn Worker Mutation)
  await t.test('2. 变异防假停止：Worker 不响应取消信号时，如实报告 waiting_tool_exit 并保留槽位', async () => {
    const db = openWorkbenchDb({ dbPath: ':memory:' })
    const domain = new WorkbenchDomain(db)

    const proj = domain.createProject({
      title: '变异测试项目',
      rootPath: tempWorkspaceDir,
      goal: '测试假停止防护',
    })

    const task = domain.createTask({
      projectId: proj.id,
      title: '顽固的不可中断工具任务',
      goal: '模拟耗时外部调用忽略 abortSignal',
    })

    let workerCleanedUp = false
    // 模拟不响应中断的 Worker（即便收到 signal 也不立即退出，需要 200ms）
    const scheduler = new TaskScheduler(
      domain,
      async (_t, _root, _signal) => {
        await new Promise((r) => setTimeout(r, 200))
        workerCleanedUp = true
        return { state: 'completed', summary: '顽固执行完毕' }
      },
      { maxGlobalConcurrency: 1 },
    )

    const runs = await scheduler.dispatchBatch([task.id], 'req-stubborn')
    assert.equal(runs.length, 1)

    // 发起快速停止（超时设为 40ms，短于 Worker 退出所需的 200ms）
    const stopResult = await scheduler.stopRun(runs[0].id, 40)

    // 关键断言：绝不能直接报告 stopped！必须如实报告 waiting_tool_exit
    assert.equal(
      stopResult.status,
      'waiting_tool_exit',
      'Worker 尚未退出时，必须如实报告 waiting_tool_exit，严禁假停止',
    )
    assert.deepEqual(stopResult.pendingToolIds, [runs[0].id])

    // 关键断言：停止期间依然占用 activeRuns，防止新任务在未收敛前抢占
    assert.equal(scheduler.canSchedule(task), false, '收敛退出前不可派发新任务')
    const snapshot = scheduler.getControlSnapshot()
    assert.equal(snapshot.items[0].state, 'stopping', '控制快照状态应为 stopping')

    // 等待 Worker 真正退出收敛
    await new Promise((r) => setTimeout(r, 220))
    assert.equal(workerCleanedUp, true)
    assert.equal(scheduler.getActiveRunCount(), 0, 'Worker 退出后槽位最终释放')
  })

  // 3. 多任务并行中只停 A，B 继续推进并产出真实副作用文件 (Independent Stop)
  await t.test('3. 多任务并行时只停 A、B 继续推进并产出真实成果文件', async () => {
    const db = openWorkbenchDb({ dbPath: ':memory:' })
    const domain = new WorkbenchDomain(db)

    const pA = domain.createProject({ title: '项目 A', rootPath: tempWorkspaceDir, goal: 'A' })
    const pB = domain.createProject({ title: '项目 B', rootPath: tempWorkspaceDir, goal: 'B' })

    const tA = domain.createTask({ projectId: pA.id, title: '任务 A', goal: 'A 会被中断' })
    const tB = domain.createTask({ projectId: pB.id, title: '任务 B', goal: 'B 正常完成' })

    const bArtifactPath = path.join(tempWorkspaceDir, '.workbench', `${tB.id}-result.json`)
    if (fs.existsSync(bArtifactPath)) fs.unlinkSync(bArtifactPath)

    const scheduler = new TaskScheduler(
      domain,
      async (t, rootPath, signal) => {
        if (t.id === tA.id) {
          // 任务 A 等待中断
          while (!signal.aborted) {
            await new Promise((r) => setTimeout(r, 20))
          }
          return { state: 'interrupted', summary: 'A 已中断', suggestedTaskStatus: 'todo' }
        } else {
          // 任务 B 正常执行并产出文件
          await new Promise((r) => setTimeout(r, 80))
          const wb = path.join(rootPath, '.workbench')
          fs.mkdirSync(wb, { recursive: true })
          fs.writeFileSync(path.join(wb, `${t.id}-result.json`), JSON.stringify({ taskId: t.id, done: true }))
          return { state: 'completed', summary: 'B 正常完成', suggestedTaskStatus: 'review' }
        }
      },
      { maxGlobalConcurrency: 2 },
    )

    const runs = await scheduler.dispatchBatch([tA.id, tB.id], 'req-parallel')
    assert.equal(runs.length, 2, '两个不同项目的任务同时开工')

    // 中途精准停止任务 A
    const stopA = await scheduler.stopRun(runs[0].id)
    assert.equal(stopA.status, 'stopped')
    assert.deepEqual(stopA.stoppedRunIds, [runs[0].id])

    // 验证：任务 A 已被中断，回退为 todo
    await new Promise((r) => setTimeout(r, 50))
    const taskAAfter = domain.getTask(tA.id)
    assert.equal(taskAAfter.statusCode, 'todo', '被停止的任务 A 状态应回退为 todo')

    // 验证：任务 B 不受影响，继续执行直至完成
    await new Promise((r) => setTimeout(r, 100))
    const taskBAfter = domain.getTask(tB.id)
    assert.equal(taskBAfter.statusCode, 'review', '未被停止的任务 B 正常完成并进入 review')
    assert.equal(fs.existsSync(bArtifactPath), true, '任务 B 的工件文件已生成')
  })

  // 4. 任务数远超并发上限后所有任务无漏项推进 (Queue Drain without Loss)
  await t.test('4. 队列超过并发上限后所有任务都能推进，无任何队列漏项', async () => {
    const db = openWorkbenchDb({ dbPath: ':memory:' })
    const domain = new WorkbenchDomain(db)

    const proj = domain.createProject({
      title: '高并发队列推进测试',
      rootPath: tempWorkspaceDir,
      goal: '测试并发打满时不丢任务',
    })

    // 创建 5 个独立任务
    const taskIds = []
    for (let i = 1; i <= 5; i++) {
      const t = domain.createTask({
        projectId: proj.id,
        title: `批量子任务 0${i}`,
        goal: `子任务 0${i}`,
      })
      taskIds.push(t.id)
    }

    const executedTaskIds = []
    // 并发上限设为 2，允许同项目并行
    const scheduler = new TaskScheduler(
      domain,
      async (task) => {
        await new Promise((r) => setTimeout(r, 25))
        executedTaskIds.push(task.id)
        return { state: 'completed', summary: `${task.title} 完成`, suggestedTaskStatus: 'review' }
      },
      { maxGlobalConcurrency: 2, allowSameProjectParallel: true },
    )

    // 一次性派发 5 个任务
    const initialRuns = await scheduler.dispatchBatch(taskIds, 'req-flood')
    assert.equal(initialRuns.length, 2, '初始受并发限制只启动 2 个')
    assert.equal(scheduler.getQueuedCount(), 3, '其余 3 个必须完整进入排队')

    // 等待所有排队任务自然消费排空
    let waitLoops = 0
    while ((scheduler.getActiveRunCount() > 0 || scheduler.getQueuedCount() > 0) && waitLoops < 50) {
      await new Promise((r) => setTimeout(r, 30))
      waitLoops++
    }

    assert.equal(scheduler.getActiveRunCount(), 0, '最终活跃数为 0')
    assert.equal(scheduler.getQueuedCount(), 0, '最终排队数必须为 0，无任何漏项')
    assert.equal(executedTaskIds.length, 5, '全部 5 个任务均被调度并完成执行')

    // 检查数据库中所有任务均到达 review
    for (const tid of taskIds) {
      assert.equal(domain.getTask(tid).statusCode, 'review')
    }
  })

  // 5. 排队与重启恢复对账 (Durable Queue & Restart Recovery)
  await t.test('5. 排队与重启恢复对账：进程重启后从 SQLite 恢复持久队列并继续调度', async () => {
    // 使用临时持久化数据库文件
    const dbFile = path.join(tempWorkspaceDir, 'recovery_test.db')
    const db1 = openWorkbenchDb({ dbPath: dbFile })
    const domain1 = new WorkbenchDomain(db1)

    const proj = domain1.createProject({
      title: '重启恢复测试项目',
      rootPath: tempWorkspaceDir,
      goal: '测试持久队列跨重启',
    })

    const t1 = domain1.createTask({ projectId: proj.id, title: '任务 1', goal: '占用并发' })
    const independentProject = domain1.createProject({ title: 'independent queued project', rootPath: tempWorkspaceDir })
    const t2 = domain1.createTask({ projectId: independentProject.id, title: '任务 2', goal: '进入排队' })

    let holdRun1
    const holdPromise = new Promise((r) => {
      holdRun1 = r
    })

    // 实例 1：并发上限 1
    const scheduler1 = new TaskScheduler(
      domain1,
      async (t) => {
        if (t.id === t1.id) {
          await holdPromise
        }
        return { state: 'completed', summary: 'ok' }
      },
      { maxGlobalConcurrency: 1, allowSameProjectParallel: true },
    )

    await scheduler1.dispatchBatch([t1.id, t2.id], 'req-persist')
    assert.equal(scheduler1.getActiveRunCount(), 1)
    assert.equal(scheduler1.getQueuedCount(), 1)

    // 验证：数据库中确实持久化了排队记录
    const persistedQueue = domain1.listPendingQueue()
    assert.equal(persistedQueue.length, 1)
    assert.equal(persistedQueue[0].taskId, t2.id)

    // 模拟进程直接崩溃/退出（任务 1 未完成直接随进程消失，数据库连接关闭）
    db1.close()

    // 模拟应用重启：全新打开 DB 并实例化全新的 TaskScheduler
    const db2 = openWorkbenchDb({ dbPath: dbFile })
    const domain2 = new WorkbenchDomain(db2)

    const executedInRestart = []
    const scheduler2 = new TaskScheduler(
      domain2,
      async (t) => {
        executedInRestart.push(t.id)
        return { state: 'completed', summary: '重启后执行完成', suggestedTaskStatus: 'review' }
      },
      { maxGlobalConcurrency: 2, allowSameProjectParallel: true },
    )

    // 关键验证：新实例构造时自动从数据库恢复了未完成的队列项
    assert.equal(scheduler2.getQueuedCount(), 1, '新调度器实例应成功从 SQLite 恢复未完成的排队项')

    // 唤醒队列推进
    scheduler2.drainQueue()
    await new Promise((r) => setTimeout(r, 60))

    assert.equal(domain2.listRuns(t1.id)[0].state, 'unknown', '崩溃前工作保留为待对账，不能假定已退出')
    assert.equal(executedInRestart.includes(t2.id), true, '其他项目的持久排队项在重启后成功执行')
    assert.equal(scheduler2.getQueuedCount(), 0, '排队项消费完毕')
    db2.close()
  })

  // 6. 重复 clientRequestId 幂等防护 (Idempotency)
  await t.test('6. 重复 clientRequestId 幂等防护：重试请求不触发二次执行与副作用', async () => {
    const db = openWorkbenchDb({ dbPath: ':memory:' })
    const domain = new WorkbenchDomain(db)

    const proj = domain.createProject({
      title: '幂等项目',
      rootPath: tempWorkspaceDir,
      goal: '幂等验证',
    })

    const task = domain.createTask({
      projectId: proj.id,
      title: '幂等测试任务',
      goal: '多次提交相同 clientRequestId',
    })

    const provider = new LocalProvider(domain)

    // 第一次调用 startRun
    const run1 = await provider.startRun({
      taskId: task.id,
      clientRequestId: 'idempotent-uuid-001',
    })
    assert.ok(run1.id)

    // 重复提交相同 clientRequestId（如网络超时客户端自动重试）
    const run2 = await provider.startRun({
      taskId: task.id,
      clientRequestId: 'idempotent-uuid-001',
    })

    // 关键断言：返回的是同一个 Run，并未创建两个并行执行
    assert.equal(run1.id, run2.id, '重复 clientRequestId 必须返回已存在的 Run')
    const runs = await provider.listRuns(task.id)
    assert.equal(runs.length, 1, '数据库中仅允许存在一条 Run 记录')
  })

  // 7. 主 Session 轮换时保留未完成任务与上下文交接 (Context Handoff Retention)
  await t.test('7. 主 Session 轮换时保留未完成任务与上下文交接，不丢历史记忆', async () => {
    const db = openWorkbenchDb({ dbPath: ':memory:' })
    const domain = new WorkbenchDomain(db)
    const contextMgr = new WorkbenchContextManager(domain)
    const provider = new LocalProvider(domain, undefined, contextMgr)

    const proj = domain.createProject({
      title: '长期推进的核心项目',
      rootPath: tempWorkspaceDir,
      goal: '保持长效交接记忆',
    })

    domain.createTask({
      projectId: proj.id,
      title: '未完成的重点任务 1',
      goal: '推进第一阶段',
      statusCode: 'in_progress',
    })
    domain.createTask({
      projectId: proj.id,
      title: '待推进的重点任务 2',
      goal: '推进第二阶段',
      statusCode: 'todo',
    })

    const initialState = domain.getAssistantState('main-assistant')

    // 执行会话轮换
    const nextState = await provider.rotateAssistantSession('main-assistant', 'session-next-generation')

    assert.equal(nextState.generation, 2)
    assert.equal(nextState.currentSessionId, 'session-next-generation')
    assert.ok(nextState.memoryIndex?.handover, '必须存有交接元数据')
    assert.equal(nextState.memoryIndex.handover.previousSessionId, initialState.currentSessionId)

    // 验证有界上下文组装：包含上一轮会话快照与未完成任务统计
    const boundedContext = contextMgr.buildBoundedContext(proj.id)
    assert.ok(boundedContext.includes('【上一轮会话交接快照】'), '提示词应包含轮换交接快照')
    assert.ok(boundedContext.includes('Gen 2'), '提示词应展示当前代次')
    assert.ok(boundedContext.includes('未决任务 2 项'), '交接摘要必须准确记录未完成任务数')
    assert.ok(boundedContext.includes('长期推进的核心项目'), '提示词应包含当前聚焦项目')
  })

  // 8. 自然语言接口端到端验证：无需选卡直接说“继续某项目”自动关联并派发
  await t.test('8. 自然语言接口端到端：直接说“继续某项目”自动关联并派发，说“停止”即刻中断', async () => {
    // 构造模拟 Cordis Context
    const routes = new Map()
    const mockCtx = {
      webServer: {
        get: (path, handler) => routes.set(`GET ${path}`, handler),
        post: (path, handler) => routes.set(`POST ${path}`, handler),
      },
      systemPrompt: {
        addSection: () => {},
      },
      tools: {
        register: () => {},
      },
    }

    apply(mockCtx, { dbPath: ':memory:' })

    const chatSendHandler = routes.get('POST /api/workbench/chat/send')
    assert.ok(chatSendHandler, 'chat/send 路由应当已成功注册')

    // 辅助调用助手
    const callChatSend = async (body) => {
      let responseData = null
      let statusCode = 200
      const req = { body }
      const res = {
        status: (code) => {
          statusCode = code
          return res
        },
        json: (data) => {
          responseData = data
          return res
        },
      }
      await chatSendHandler(req, res)
      return { status: statusCode, data: responseData }
    }

    // 8.1 用户直接说：“继续推进工作台施工”
    const continueRes = await callChatSend({
      text: '继续推进工作台施工',
    })

    assert.equal(continueRes.status, 200)
    assert.ok(continueRes.data.reply, '主助理必须返回动态结构化回复')
    assert.ok(
      continueRes.data.reply.text.includes('已为您续接项目【DSH Table 工作台施工】'),
      '无需拖卡即可精准识别项目意图并自动续接',
    )
    assert.ok(continueRes.data.runs?.length > 0, '应当已自动派发就绪任务')

    // 8.2 用户直接说：“全停”
    const stopRes = await callChatSend({
      text: '全停',
    })

    assert.equal(stopRes.status, 200)
    assert.ok(['stopped', 'waiting_tool_exit'].includes(stopRes.data.stopResult.status))
    assert.match(stopRes.data.reply.text, stopRes.data.stopResult.status === 'stopped' ? /已确认当前工作停止/ : /不能确认全部停止/, '回执必须对应真实停止状态')
    assert.equal(stopRes.data.stopResult.status, 'stopped')
  })

  // 9. 隔离停止范围回归：A 运行、B 排队且属于不同工作意图；只停止 A，B 绝不被取消并正常执行完毕
  await t.test('9. 隔离停止范围：A 运行、B 排队且不同意图；停止 A 绝不误取消 B，且 stopIntent 超时保持 stopping', async () => {
    const db = openWorkbenchDb({ dbPath: ':memory:' })
    const domain = new WorkbenchDomain(db)

    const proj = domain.createProject({
      title: '停止范围隔离项目',
      rootPath: tempWorkspaceDir,
      goal: '验证范围隔离',
    })

    const tA = domain.createTask({ projectId: proj.id, title: '任务 A', goal: '意图 A' })
    const tB = domain.createTask({ projectId: proj.id, title: '任务 B', goal: '意图 B' })

    const intentA = domain.createWorkIntent('执行任务 A', proj.id)
    const intentB = domain.createWorkIntent('执行任务 B', proj.id)

    let bExecuted = false
    let resolveTaskA
    const taskAPromise = new Promise((r) => {
      resolveTaskA = r
    })

    // 并发限制为 1，确保 B 必须在队列中等待 A 完成
    const scheduler = new TaskScheduler(
      domain,
      async (t, _root, signal) => {
        if (t.id === tA.id) {
          while (!signal.aborted) {
            await new Promise((r) => setTimeout(r, 20))
          }
          return { state: 'interrupted', summary: 'A 已中断' }
        } else if (t.id === tB.id) {
          bExecuted = true
          return { state: 'completed', summary: 'B 正常执行完成', suggestedTaskStatus: 'review' }
        }
        return { state: 'completed', summary: 'ok' }
      },
      { maxGlobalConcurrency: 1, allowSameProjectParallel: true },
    )

    // 意图 A 派发任务 A（启动执行）
    await scheduler.dispatchBatch([tA.id], 'req-A', intentA.id)
    assert.equal(scheduler.getActiveRunCount(), 1)

    // 意图 B 派发任务 B（由于并发为 1，进入排队队列）
    await scheduler.dispatchBatch([tB.id], 'req-B', intentB.id)
    assert.equal(scheduler.getQueuedCount(), 1)

    // 精准停止意图 A（或停止任务 A）
    const stopResultA = await scheduler.stopIntent(intentA.id)
    assert.equal(stopResultA.status, 'stopped')

    // 关键断言 1：任务 B 绝不能被当成旧代次取消！它必须仍保留在队列中或已被 drainQueue 唤醒执行
    await new Promise((r) => setTimeout(r, 80))

    assert.equal(bExecuted, true, '任务 B 必须在任务 A 停止后自动推进并执行完毕')
    assert.equal(domain.getTask(tB.id).statusCode, 'review', '任务 B 状态应正常进入 review')

    // 关键断言 2：stopIntent 超时未退出时，持久状态必须保持 stopping，绝不能提前标 stopped
    const intentStubborn = domain.createWorkIntent('执行顽固意图', proj.id)
    const tStubborn = domain.createTask({ projectId: proj.id, title: '顽固任务', goal: '不退出' })
    const schedulerStubborn = new TaskScheduler(
      domain,
      async () => {
        await new Promise((r) => setTimeout(r, 150))
        return { state: 'completed', summary: 'done' }
      },
      { maxGlobalConcurrency: 1 },
    )

    await schedulerStubborn.dispatchBatch([tStubborn.id], 'req-stubborn-intent', intentStubborn.id)
    // 快速停止（超时设为 20ms）
    const stubbornStopRes = await schedulerStubborn.stopIntent(intentStubborn.id, 20)
    assert.equal(stubbornStopRes.status, 'waiting_tool_exit')
    // 验证：数据库中的 WorkIntent 状态必须保持为 stopping，严禁提前设为 stopped
    const persistentIntent = domain.getWorkIntent(intentStubborn.id)
    assert.equal(persistentIntent.status, 'stopping', '超时未退出时持久状态必须保持 stopping')
  })

  // 10. 自然语言安全性防误派发：'不要继续项目A'、'先讨论方案'、'继续那个' 不误触发开工
  await t.test('10. 自然语言安全性防误派发：否定、方案讨论不触发开工；指代不明时发起澄清提问', async () => {
    const routes = new Map()
    const mockCtx = {
      webServer: {
        get: (path, handler) => routes.set(`GET ${path}`, handler),
        post: (path, handler) => routes.set(`POST ${path}`, handler),
      },
      systemPrompt: { addSection: () => {} },
      tools: { register: () => {} },
    }

    apply(mockCtx, { dbPath: ':memory:' })
    const chatSendHandler = routes.get('POST /api/workbench/chat/send')

    const callChat = async (text) => {
      let responseData = null
      const req = { body: { text } }
      const res = { status: () => res, json: (d) => { responseData = d; return res } }
      await chatSendHandler(req, res)
      return responseData
    }

    // 10.1 否定指令：“不要继续推进项目”
    const negRes = await callChat('不要继续推进工作台施工')
    assert.ok(negRes.reply.text.includes('暂不启动或推进相关项目工作'), '否定指令必须正确拦截，不可开工')
    assert.equal(negRes.runs, undefined, '严禁生成 runs')

    // 10.2 讨论指令：“先讨论怎么推进项目”
    const discRes = await callChat('先讨论怎么推进DSH工作台')
    assert.ok(discRes.reply.text.length > 5, '讨论指令必须返回回复')
    assert.equal(discRes.runs, undefined, '严禁生成 runs，必须仅作为沟通讨论')

    // 10.3 指代不明指令：“继续那个”
    const ambRes = await callChat('继续那个')
    assert.ok(ambRes.reply.text.includes('请问你想继续推进哪个具体项目'), '项目不明确时必须发起澄清提问，绝不默认开工')
    assert.equal(ambRes.runs, undefined, '严禁盲目开工')
  })

  // 11. 停止后重新推进同一卡（立即启动与排队后启动两种情况验证）
  await t.test('11. 停止后重新推进同一卡：立即启动与排队启动均可正常恢复，绝不被旧取消标记永久锁死', async () => {
    const db = openWorkbenchDb({ dbPath: ':memory:' })
    const domain = new WorkbenchDomain(db)

    const proj = domain.createProject({
      title: '重启任务测试项目',
      rootPath: tempWorkspaceDir,
      goal: '验证停止后再次调度',
    })

    const taskRestart = domain.createTask({
      projectId: proj.id,
      title: '可反复启停的核心卡片',
      goal: '测试重调度',
    })

    let runCount = 0
    let shouldAbort = true
    const scheduler = new TaskScheduler(
      domain,
      async (_t, _root, signal) => {
        runCount++
        if (shouldAbort) {
          while (!signal.aborted) {
            await new Promise((r) => setTimeout(r, 20))
          }
          return { state: 'interrupted', summary: '第 1 次被中断' }
        } else {
          return { state: 'completed', summary: '后续执行成功', suggestedTaskStatus: 'review' }
        }
      },
      { maxGlobalConcurrency: 1, allowSameProjectParallel: true },
    )

    // 第一次启动
    const firstRuns = await scheduler.dispatchBatch([taskRestart.id], 'run-1')
    assert.equal(firstRuns.length, 1)

    // 停止本次执行
    const stopRes = await scheduler.stopRun(firstRuns[0].id)
    assert.equal(stopRes.status, 'stopped')
    await new Promise((r) => setTimeout(r, 40))

    // 关键验证 A：停止后立即重新推进同一卡（立即启动模式）
    shouldAbort = false
    const secondRuns = await scheduler.dispatchBatch([taskRestart.id], 'run-2')
    assert.equal(secondRuns.length, 1, '停止后的同一卡片必须能正常再次启动，绝不能被 cancelledTaskIds 误杀')

    await new Promise((r) => setTimeout(r, 50))
    assert.equal(domain.getTask(taskRestart.id).statusCode, 'review')
    assert.equal(runCount, 2)

    // 关键验证 B：停止后先排队再启动模式
    // 创建一个占位任务占用槽位
    const tHolder = domain.createTask({ projectId: proj.id, title: '占位任务', goal: '占用并发' })
    let releaseHolder
    const holderPromise = new Promise((r) => { releaseHolder = r })

    const schedulerHolder = new TaskScheduler(
      domain,
      async (t) => {
        if (t.id === tHolder.id) {
          await holderPromise
        }
        return { state: 'completed', summary: 'done', suggestedTaskStatus: 'review' }
      },
      { maxGlobalConcurrency: 1, allowSameProjectParallel: true },
    )

    // 启动占位任务
    await schedulerHolder.dispatchBatch([tHolder.id], 'hold-run')
    assert.equal(schedulerHolder.getActiveRunCount(), 1)

    // 再次将 taskRestart 入队（此时并发已满，进入排队队列）
    domain.updateTask({ id: taskRestart.id, expectedRevision: domain.getTask(taskRestart.id).revision, statusCode: 'todo' })
    await schedulerHolder.dispatchBatch([taskRestart.id], 'queued-after-stop')
    assert.equal(schedulerHolder.getQueuedCount(), 1, '任务应成功进入排队')

    // 释放占位任务，排队项被唤醒调度
    releaseHolder()
    await new Promise((r) => setTimeout(r, 80))

    assert.equal(schedulerHolder.getActiveRunCount(), 0)
    assert.equal(schedulerHolder.getQueuedCount(), 0)
    assert.equal(domain.getTask(taskRestart.id).statusCode, 'review', '排队后的卡片在槽位空出后成功执行')
  })

  // 12. 严格工作区物理边界与成果历史版本记录
  await t.test('12. 严格工作区物理边界：目录不存在时明确报错拒绝，禁止回退进程目录；成果保存历史版本', async () => {
    const testDbFile = path.join(tempWorkspaceDir, 'boundary_test.sqlite')
    const db = openWorkbenchDb({ dbPath: testDbFile })
    const domain = new WorkbenchDomain(db)

    const invalidPath = path.join(tempWorkspaceDir, 'non_existent_folder_xyz')
    const projInvalid = domain.createProject({
      title: '不存在路径的项目',
      rootPath: invalidPath,
      goal: '边界测试',
    })

    const tInvalid = domain.createTask({
      projectId: projInvalid.id,
      title: '边界测试卡片',
      goal: '测试目录不存在',
    })

    const routes = new Map()
    const mockCtx = {
      webServer: { get: (p, h) => routes.set(`GET ${p}`, h), post: (p, h) => routes.set(`POST ${p}`, h) },
      systemPrompt: { addSection: () => {} },
      tools: { register: () => {} },
    }

    // 边界半区使用产品默认执行器（其内置工作区物理边界检查，不得被注入替换）。
    apply(mockCtx, { dbPath: testDbFile })
    const startRunHandler = routes.get('POST /api/workbench/runs/start')
    const injectExecutorFor = () => {
      // 成果半区：注入与真实执行器同契约的 executor（WorkBuddy 桥接已移除，成果落盘属执行器职责），
      // 验证产品把 artifactRefs 完整落到 Result 并回流。
      return async (task, projectRoot) => {
      const wbDir = path.join(projectRoot, '.workbench')
      const runsDir = path.join(wbDir, 'runs')
      fs.mkdirSync(runsDir, { recursive: true })
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      const versioned = path.join(runsDir, `${task.id}-${ts}.md`)
      const rootFile = path.join(wbDir, `${task.id}-result.md`)
      fs.writeFileSync(versioned, `# ${task.title} 交付（历史版本）`, 'utf-8')
      fs.writeFileSync(rootFile, `# ${task.title} 交付`, 'utf-8')
      return {
        state: 'completed',
        summary: `已交付：${task.title}`,
        artifactRefs: [{ title: `业务交付物：${task.title}`, path: rootFile, kind: 'markdown' }],
        evidenceRefs: [versioned],
        suggestedTaskStatus: 'review',
      }
      }
    }
    // 成果半区：同一 DB 文件、独立 apply（注入执行器）
    const routes2 = new Map()
    const mockCtx2 = {
      webServer: { get: (p, h) => routes2.set(`GET ${p}`, h), post: (p, h) => routes2.set(`POST ${p}`, h) },
      systemPrompt: { addSection: () => {} },
      tools: { register: () => {} },
    }
    apply(mockCtx2, { dbPath: testDbFile, workerExecutor: injectExecutorFor() })
    const startRunHandler2 = routes2.get('POST /api/workbench/runs/start')

    let resData = null
    let resCode = 200
    await startRunHandler(
      { body: { taskId: tInvalid.id, clientRequestId: 'req-boundary-test' } },
      { status: (c) => { resCode = c; return { json: (d) => { resData = d } } }, json: (d) => { resData = d } },
    )

    // 等待异步 worker 执行收敛
    await new Promise((r) => setTimeout(r, 100))

    // 验证：任务卡绝不能被伪造通过，必须进入 blocked 状态并记录目录不存在的明确证据
    const taskAfter = domain.getTask(tInvalid.id)
    assert.equal(taskAfter.statusCode, 'blocked', '目录不存在时必须置为 blocked')
    const runs = domain.listRuns(tInvalid.id)
    assert.ok(runs.length > 0)
    assert.equal(runs[0].state, 'failed')

    // 验证成果历史版本落盘：在有效工作区目录下执行任务，应生成 runs/ 历史版本与根文件
    const validPath = path.join(tempWorkspaceDir, 'valid_folder')
    fs.mkdirSync(validPath, { recursive: true })
    const projValid = domain.createProject({
      title: '有效路径项目',
      rootPath: validPath,
      goal: '历史版本测试',
    })
    const tValid = domain.createTask({
      projectId: projValid.id,
      title: '历史版本卡片',
      goal: '测试成果保存',
    })

    await startRunHandler2(
      { body: { taskId: tValid.id, clientRequestId: 'req-valid-history-test' } },
      { status: (c) => { resCode = c; return { json: (d) => { resData = d } } }, json: (d) => { resData = d } },
    )

    // 等待注入执行器落盘后产品代码记录 Result；不代表真实模型/宿主证据。
    const wbRunsDir = path.join(validPath, '.workbench', 'runs')
    for (let i = 0; i < 150; i++) {
      if (fs.existsSync(wbRunsDir) && fs.readdirSync(wbRunsDir).length > 0) break
      await new Promise((r) => setTimeout(r, 100))
    }

    assert.ok(fs.existsSync(wbRunsDir), '.workbench/runs 目录必须生成')
    const versionedFiles = fs.readdirSync(wbRunsDir)
    assert.ok(versionedFiles.length > 0, '必须产出至少一个带版本时间戳的成果文件')
    assert.ok(fs.existsSync(path.join(validPath, '.workbench', `${tValid.id}-result.md`)), '根成果文件必须存在')
  })

  // 13. 严格 Token 预算循环裁剪核算
  await t.test('13. 严格 Token 预算循环裁剪核算：预算偏小设定下严格裁剪至上限以内，保全核心事实', async () => {
    const db = openWorkbenchDb({ dbPath: ':memory:' })
    const domain = new WorkbenchDomain(db)
    const contextMgr = new WorkbenchContextManager(domain)

    // 创建大量项目以撑大上下文
    for (let i = 1; i <= 20; i++) {
      const p = domain.createProject({
        title: `长名称测试项目编号-${i}-关于分布式调度与存储的超长业务方案设计`,
        rootPath: `C:\\projects\\long-path-${i}`,
        goal: `这是一段非常冗长的目标描述，用于测试上下文预算超额场景下的裁剪能力 ${i}`,
      })
      domain.createTask({ projectId: p.id, title: `任务卡-${i}`, goal: `目标-${i}` })
    }

    // 设定极为严格的预算上限 (500 tokens)
    const tightBudget = { maxPromptTokens: 500 }
    const boundedPrompt = contextMgr.buildBoundedContext(undefined, [], tightBudget)

    const estimated = contextMgr.estimateTokens(boundedPrompt)
    // 关键断言：无论原始文本多长，循环裁剪必须确保最终估算 Token 严格 <= 500
    assert.ok(estimated <= 500, `最终 Token 数 (${estimated}) 必须严格在上限 500 以内`)
    assert.ok(boundedPrompt.includes('【DSH 工作台主助理】'), '核心身份原则必须被优先保留')
  })

  // 14. 多轮连续对话上下文贯通与任务卡更新接口
  await t.test('14. 多轮连续对话贯通与任务卡更新：支持指代修定与真实任务材料保存接口', async () => {
    const routes = new Map()
    const mockCtx = {
      webServer: { get: (p, h) => routes.set(`GET ${p}`, h), post: (p, h) => routes.set(`POST ${p}`, h) },
      systemPrompt: { addSection: () => {} },
      tools: { register: () => {} },
    }

    apply(mockCtx, { dbPath: ':memory:' })
    const chatSendHandler = routes.get('POST /api/workbench/chat/send')
    const taskUpdateHandler = routes.get('POST /api/workbench/tasks/update')
    assert.ok(taskUpdateHandler, 'tasks/update 端点必须已注册')

    // 14.1 测试任务卡目标与材料补充更新接口
    const updateReq = {
      body: {
        id: 'task-client-view',
        expectedRevision: 1,
        title: '验证前端主工作台面板（已补充材料）',
        goal: '已补充会议记录材料：前端团队确认完成三栏布局与拖拽组件联调。',
        acceptance: '要求界面无报错，控制条正常刷新',
      },
    }

    let updateResData = null
    await taskUpdateHandler(updateReq, { json: (d) => { updateResData = d }, status: () => ({ json: (d) => { updateResData = d } }) })
    assert.ok(updateResData)
    assert.equal(updateResData.title, '验证前端主工作台面板（已补充材料）')
    assert.ok(updateResData.goal.includes('已补充会议记录材料'))

    // 14.2 测试连续对话多轮持久化与指代
    const callChat = async (text) => {
      let d = null
      await chatSendHandler({ body: { text } }, { json: (res) => { d = res }, status: () => ({ json: (res) => { d = res } }) })
      return d
    }

    // 第 1 轮沟通要求
    const r1 = await callChat('纪要要求用极简清单风格，不要任何多余的开场白')
    assert.ok(r1?.reply?.text)

    // 第 2 轮指代上一轮
    const r2 = await callChat('按刚才的要求，为我们梳理一下今天的进度重点')
    assert.ok(r2?.reply?.text)

    // 验证历史会话中真实包含这两轮完整记录
    const msgsHandler = routes.get('GET /api/workbench/chat/messages')
    let allMsgs = null
    await msgsHandler({}, { json: (d) => { allMsgs = d } })
    assert.ok(allMsgs.length >= 4, '数据库必须持久化多轮上下文')
    assert.equal(allMsgs.some((m) => m.text.includes('极简清单风格')), true, '多轮上下文历史必须完整保持')
  })

  // 15. 后台成果与卡点自动回流主入口对话（用户无需追问、刷新或手动整理记忆）
  await t.test('15. 后台 Run 结束后成果/失败结论自动回流主对话，且同一 Run 严格只回流一次', async () => {
    const routes = new Map()
    const mockCtx = {
      webServer: { get: (p, h) => routes.set(`GET ${p}`, h), post: (p, h) => routes.set(`POST ${p}`, h) },
      systemPrompt: { addSection: () => {} },
      tools: { register: () => {} },
    }

    // 桥接已移除：注入 completed 执行器驱动“成功回流”半区（15.2 诚实失败半区走产品默认路径）
    const okExecutor = async (task) => ({
      state: 'completed',
      summary: `整理完成：${task.title}`,
      artifactRefs: [{ title: `业务交付物：${task.title}`, path: 'C:\\evidence-stub\\deliverable.md', kind: 'markdown' }],
      suggestedTaskStatus: 'review',
    })
    apply(mockCtx, { dbPath: ':memory:', workerExecutor: okExecutor })

    const callRoute = async (key, body) => {
      const handler = routes.get(key)
      assert.ok(handler, `${key} 路由必须已注册`)
      let data = null
      const res = {
        status: () => res,
        json: (d) => {
          data = d
          return res
        },
      }
      await handler({ body: body ?? {}, query: {} }, res)
      return data
    }
    const listChat = async () => callRoute('GET /api/workbench/chat/messages')
    const listTasks = async () => callRoute('GET /api/workbench/tasks')

    // 15.1 成功执行：成果摘要与交付物自动出现在主对话
    const okCard = await callRoute('POST /api/workbench/tasks', {
      projectId: 'proj-default',
      title: '回流验证卡：干净成功',
      goal: '整理一份任务清单',
      acceptance: '必须包含测试材料',
    })
    await callRoute('POST /api/workbench/runs/start', {
      taskId: okCard.id,
      clientRequestId: `flow-ok-${Date.now()}`,
    })
    for (let i = 0; i < 100; i++) {
      const t = (await listTasks()).find((x) => x.id === okCard.id)
      if (t && t.statusCode !== 'in_progress' && t.statusCode !== 'todo') break
      await new Promise((r) => setTimeout(r, 100))
    }

    const chatAfterOk = await listChat()
    const delivered = chatAfterOk.filter((m) => m.sender === 'assistant' && m.text.includes('回流验证卡：干净成功'))
    assert.equal(delivered.length, 1, '完成结论必须在主对话中严格出现一次')
    assert.ok(delivered[0].text.startsWith('✅ 已完成'), '完成回流消息必须明确标注已完成')
    assert.ok(delivered[0].text.includes('交付物：'), '回流消息必须给出可定位的交付物路径')
    assert.ok(/卡片状态：/.test(delivered[0].text), '回流消息必须披露卡片当前状态')

    // 15.2 失败阻塞：结论同样回流，且不伪造完成
    // 先建立根目录不存在的项目，再在其中建卡，触发严格工作区边界失败路径
    let created = null
    // 15.2 诚实失败半区：产品默认执行器（内置边界检查），独立 apply 与路由
    const routes2 = new Map()
    const mockCtx2 = {
      webServer: { get: (p, h) => routes2.set(`GET ${p}`, h), post: (p, h) => routes2.set(`POST ${p}`, h) },
      systemPrompt: { addSection: () => {} },
      tools: { register: () => {} },
    }
    apply(mockCtx2, { dbPath: ':memory:' })
    await routes2.get('POST /api/workbench/projects')(
      { body: { id: 'proj-missing-root', title: '缺失根目录项目', rootPath: 'C:\\__dsh_absent_root__', goal: '边界测试' } },
      { status: () => ({ json: (d) => { created = d } }), json: (d) => { created = d } },
    )
    const callRoute2 = async (key, body) => {
      const handler = routes2.get(key)
      assert.ok(handler, `${key} 路由必须已注册`)
      let data = null
      const res = {
        status: () => res,
        json: (d) => {
          data = d
          return res
        },
      }
      await handler({ body: body ?? {}, query: {} }, res)
      return data
    }
    const badCard = await callRoute2('POST /api/workbench/tasks', {
      projectId: 'proj-missing-root',
      title: '回流验证卡：工作区缺失',
      goal: '在不存在目录执行',
    })
    assert.equal(badCard.projectId, 'proj-missing-root', '任务必须建在缺失根目录项目中')
    await callRoute2('POST /api/workbench/runs/start', {
      taskId: badCard.id,
      clientRequestId: `flow-bad-${Date.now()}`,
    })
    for (let i = 0; i < 100; i++) {
      const t = (await callRoute2('GET /api/workbench/tasks', {})).find((x) => x.id === badCard.id)
      if (t && t.statusCode === 'blocked') break
      await new Promise((r) => setTimeout(r, 100))
    }
    const chatAfterBad = await callRoute2('GET /api/workbench/chat/messages', {})
    const blockedMsg = chatAfterBad.filter((m) => m.sender === 'assistant' && m.text.includes('回流验证卡：工作区缺失'))
    assert.equal(blockedMsg.length, 1, '失败结论必须回流且只有一次')
    assert.ok(blockedMsg[0].text.startsWith('⚠️ 未完成'), '失败必须如实标注未完成，不得伪造成功')
    assert.ok(blockedMsg[0].text.includes('阻塞'), '失败回流必须说明卡片被标记阻塞')
  })

  // 16. 明确工作请求自动关联/建卡并派发；闲聊与疑问不批量生产活跃卡
  await t.test('16. 明确工作请求自动建卡并后台派发、同请求复用既有卡；疑问与讨论不误建卡', async () => {
    const routes = new Map()
    const mockCtx = {
      webServer: { get: (p, h) => routes.set(`GET ${p}`, h), post: (p, h) => routes.set(`POST ${p}`, h) },
      systemPrompt: { addSection: () => {} },
      tools: { register: () => {} },
    }

    apply(mockCtx, { dbPath: ':memory:' })

    const callChat = async (text) => {
      let d = null
      await routes.get('POST /api/workbench/chat/send')(
        { body: { text } },
        { status: () => ({ json: (res) => { d = res } }), json: (res) => { d = res } },
      )
      return d
    }
    const listTasks = async () => {
      let d = null
      await routes.get('GET /api/workbench/tasks')({ query: {} }, { json: (r) => { d = r } })
      return d
    }

    const before = (await listTasks()).length

    const first = await callChat('帮我整理这周的客户会议纪要并提炼待办')
    assert.ok(first?.task, '明确工作请求必须自动建立或关联任务卡')
    assert.ok(first.reply.text.includes('自动建立任务卡'), '首次请求应说明已自动建卡')
    assert.ok(first.runs?.length > 0, '明确工作请求必须走真实调度链路开始后台执行')
    const afterFirst = (await listTasks()).length
    assert.equal(afterFirst, before + 1, '首次请求只允许新增一张卡')

    // 同一请求重复出现时必须复用既有未完成卡，不能重复建卡
    const second = await callChat('帮我整理这周的客户会议纪要并提炼待办')
    assert.equal(second.task.id, first.task.id, '重复请求必须复用同一张卡')
    assert.ok(second.reply.text.includes('既有任务卡'), '重复请求应如实说明复用了既有卡')
    assert.equal((await listTasks()).length, afterFirst, '重复请求不得新增任务卡')

    // 疑问句不是工作指令
    const question = await callChat('帮我整理一下这份材料可以吗？')
    assert.equal(question.task, undefined, '疑问句不得自动建卡或派发')

    // 方案讨论不是开工指令（走讨论分支，不产生新卡）
    const discussion = await callChat('我们来讨论一下怎么整理客户材料更好')
    assert.equal(discussion.task, undefined, '讨论分支不得自动建卡')
    assert.equal((await listTasks()).length, afterFirst, '闲聊与讨论不得批量生产活跃卡')
  })
})
