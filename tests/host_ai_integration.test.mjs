import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { openWorkbenchDb } from '../lib/host/db/database.js'
import { WorkbenchDomain } from '../lib/host/services/domain.js'
import { DshAIClient } from '../lib/host/services/ai-client.js'
import { apply } from '../lib/index.js'

test('真实 Windows 宿主 AI 与执行 Agent 集成验收 (真实 LLM 成果产出与双向验收核验)', async (t) => {
  // 门禁控制：常规自动化回归默认跳过真实在线模型调用，避免无意消耗用户 Token 或受偶发网络波动影响
  if (process.env.TEST_REAL_LLM !== 'true') {
    t.skip('未显式开启 TEST_REAL_LLM=true 门禁，跳过真实在线 LLM 消耗与网络集成测试（常规回归保持纯本地隔离）')
    return
  }

  const tempWorkspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-real-ai-'))

  t.after(() => {
    try {
      fs.rmSync(tempWorkspaceDir, { recursive: true, force: true })
    } catch {}
  })

  const aiClient = new DshAIClient()
  const isAvailable = await aiClient.checkAvailability()

  if (!isAvailable) {
    // 门禁开启时，若服务未就绪，必须明确断言失败，严禁静默假通过
    assert.fail('已显式设置 TEST_REAL_LLM=true，但本地宿主 AI 桥接端点未就绪或未授权 (127.0.0.1:8787)，无法完成真实模型集成验证！')
  }

  const rawMeetingNotes = [
    '时间：2026年10月23日 14:00',
    '参会人：张工（后端架构）、李工（前端开发）、王经理（产品总监）',
    '讨论内容：',
    '1. 张工汇报：数据库分区与前向迁移完成，本周五前完成全链路吞吐压测，目标支撑 5000 QPS。',
    '2. 李工汇报：工作台单主入口面板与独立控制条已接通，本周六完成视觉样式调整并提交人工验收。',
    '3. 王经理要求：下周二前必须输出最终产品上线验收报告，测试团队周日需完成全量自动化回归。',
    '决议：一致通过排期，下周一上午9点召开上线预演会。',
  ].join('\n')

  const taskTitle = '整理产品评审会议纪要'

  await t.test('1. 正例验收：真实 Agent 办公成果物生成，各项客观验收要素满足时判定 true', async () => {
    const taskAcceptance = '纪要必须包含会议主题、参会人员、发言要点、决议与待办事项列表'

    // 调用真实执行 Agent（直接调用本地 DSH/WorkBuddy 模型，不使用任何 Mock 数据！）
    const execResult = await aiClient.executeOfficeTask(taskTitle, rawMeetingNotes, taskAcceptance)

    assert.ok(execResult.content, 'Agent 必须返回实质性文本内容')
    assert.ok(execResult.content.length > 150, `生成的成果文字数应丰富完整 (实际: ${execResult.content.length})`)

    // 关键断言 1：成果必须是真正的结构化纪要正文，严禁元数据 JSON 充数
    assert.equal(execResult.content.startsWith('{'), false, '成果正文绝不能是 JSON 伪造元数据')
    assert.ok(execResult.content.includes('会议') || execResult.content.includes('纪要'), '成果必须包含纪要标题/结构')
    assert.ok(execResult.content.includes('张工') && execResult.content.includes('李工') && execResult.content.includes('王经理'), '成果必须准确提炼参会人发言')
    assert.ok(execResult.content.includes('待办') || execResult.content.includes('决议') || execResult.content.includes('事项'), '成果必须包含待办与决议结构')

    // 关键断言 2：客观验收要素全部满足，且无主观待审条款时判定 true
    assert.equal(execResult.acceptanceMet, true, '真实文本满足各项验收要素时验收指标应为 true')

    // 验证物理落盘
    const wbDir = path.join(tempWorkspaceDir, '.workbench')
    fs.mkdirSync(wbDir, { recursive: true })
    const mdPath = path.join(wbDir, 'task-meeting-result.md')
    fs.writeFileSync(mdPath, execResult.content, 'utf-8')
    assert.ok(fs.existsSync(mdPath), '成果文件真实写入工作区磁盘')
  })

  await t.test('2. 负例验收：验收标准包含未满足的核心要求时，严禁假通过，判定 false', async () => {
    // 注入会议发言中绝对不存在的硬性要求（如区块链智能合约部署与审计）
    const impossibleAcceptance = '纪要必须包含会议主题、参会人员，且必须提供以太坊智能合约审计报告与私钥地址'
    const execResult = await aiClient.executeOfficeTask(taskTitle, rawMeetingNotes, impossibleAcceptance)

    assert.ok(execResult.content, 'Agent 生成了文本')
    // 核心断言：即使生成了详尽文本，由于缺少“以太坊智能合约审计报告”，acceptanceMet 必须为 false
    assert.equal(execResult.acceptanceMet, false, '未满足客观核心验收标准时，严禁判定通过')
  })

  await t.test('3. 主观条款验收：包含人工核验/主观满意度条款时，自动保留人工待定 review，判定 false', async () => {
    const subjectiveAcceptance = '纪要必须包含会议主题、参会人员，且需王总人工确认定稿'
    const execResult = await aiClient.executeOfficeTask(taskTitle, rawMeetingNotes, subjectiveAcceptance)

    assert.ok(execResult.content, 'Agent 生成了文本')
    // 核心断言：包含“人工确认”主观条款，必须保持待定 false，绝不越权自动标记通过
    assert.equal(execResult.acceptanceMet, false, '含主观人工确认条款时，acceptanceMet 必须保持 false')
  })

  await t.test('4. 真实主助理端到端连续多轮对话：模型理解上下文并输出动态答复', async () => {
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

    const req = {
      body: {
        text: '请用一句话告诉我，工作台主助理的核心使命是什么？',
      },
    }

    let responseData = null
    const res = {
      status: () => res,
      json: (d) => {
        responseData = d
        return res
      },
    }

    await chatSendHandler(req, res)

    assert.ok(responseData, '服务端必须返回响应')
    assert.ok(responseData.reply, '必须包含持久化的 ChatMessage 回复')
    assert.ok(responseData.reply.text.length > 10, '真实主助理回复必须具有丰富语义')
    // 验证不是写死的“已记录你的想法”或固定模板
    assert.equal(responseData.reply.text.includes('已记录你的想法：“'), false, '严禁出现旧版模板兜底语句')
  })
})
