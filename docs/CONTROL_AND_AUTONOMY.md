# 工作控制与主动任务维护：补充设计

版本：0.2-draft；日期：2026-10-23（Asia/Shanghai）。这是施工规格，尚未实现或验收。补充原ARCHITECTURE与VERIFICATION；发生冲突时先按本文件明确语义，并通过ADR更新旧文档，不能只在代码里另做一套。

## 1. 三层链路与两种生命周期

用户 → 主助理 → 项目执行Agent。主助理回合结束，不代表其下派的工作结束。

必须分别持有：
- conversationTurn：当前主助理的生成/回复；
- workIntent：用户本次工作要求的稳定根；
- batch/run/activation/job：实际排队、执行、子孙和工具工作；
- task：可跨多次执行的长期事项。

UI不能仅根据主助理isGenerating决定是否显示工作控制。主助理空闲、Session轮换或界面重开，都不使后台Run消失。

## 2. 持续可见的控制入口

1. 输入栏运行时按钮标为“停止本次请求”，语义为当前workIntent及已经归属它的工作；tooltip/无障碍名称明确范围。
2. 派发回执卡保持“停止这次工作”入口，不随主助理回合结束消失。
3. 主界面固定后台工作条，显示运行/排队/等待数量和“查看工作”“停止工作台全部工作”。不能只在有主助理流式输出时显示。这里的全部只包含本工作台登记并拥有的工作，不关闭整个DSH或其他来源任务。
4. 卡片/Run详情有精确“停止本轮执行”和“继续”；停止任务的按钮不删除卡片。
5. 用户在旧后台运行时发一条无关闲聊，再停止这次闲聊，不停止之前的任务。按workIntent范围判断，不按“当前屏幕上所有Agent”。
6. 多个项目同时运行时提供可点的工作列表，不能要求用户知道Session ID。

当主助理已经结束而后台仍工作，发送按钮仍可发送新内容，工作控制条仍可停止后台。不用一个发送/停止图标承担全部语义。

## 3. 自然语言控制

- “停一下A / 取消刚才这次 / 停止所有工作”解析为有范围的控制命令。
- 当前明确只有一项工作且指代唯一时直接执行，给简短回执。
- “停一下”在多项工作且指代不唯一时，不猜测杀任务：先可逆地冻结本用户新派发，显示当前候选，问一个范围问题。冻结不能静默超时后恢复；界面可明确解除。
- 明确“全停”可直接停止当前所有属于本用户的工作，不重复等待模型解释。
- “不要停止A”“停止按钮在哪里”“文案写‘停止工作’”不是停止命令。不能用文本includes('停')触发。
- “先别做B，A继续”应只暂停/撤出B，不影响A。
- 控制按钮的可靠路径不依赖LLM；自然语言只是进入同一控制服务的另一入口。
- 引号、语音转写纠正、否定、反问和中英混合要有语义测试。无法判定时最多澄清一次，不执行破坏性猜测。

## 4. Stop、Pause、Resume、Cancel task、Delete的区别

| 动作 | 含义 |
| --- | --- |
| 停止本次请求/执行 | 阻止该范围继续派发，取消尚可取消的执行，保存部分成果；任务本身仍可继续 |
| 暂停 | 停派发并在能力允许时中断/收敛到检查点，显示已暂停或仍在停止 |
| 继续 | 读取检查点与实际成果，新建可追溯的继续Run，不盲目重放原全部指令 |
| 取消任务 | 用户明确放弃该长期事项，卡片软取消，依赖重新判定；不删除成果 |
| 删除/回滚文件 | 独立高影响操作，停止不自动包含它 |

并非所有工具支持可恢复暂停。不得对不可暂停工具显示已暂停；可以显示“已请求停止，当前工具需等待结束”。继续时没有检查点就先核对实际状态。

## 5. Windows独立控制服务

控制服务随工作台Host存在，不归某一次主助理回合的fiber，也不归当前主Session。Mac通过Remote Connect直达此服务，主助理无需在线。

拟定契约（本项目新增，不是既有DSH API）：
control.request({
  commandId, action, target: { kind, ids },
  hostId, profileId, expectedControlRevision, observedGeneration
})
→ receipt：received/accepted/already_terminal/conflict/offline_unknown；
control.follow(commandId) → 各目标真实停止进度和终态。

控制需要稳定workIntentId、batchId、runId、workerSessionId、activationId/jobId及owner映射。进程内父子归因不能代替持久映射；重启后仍应能对账。

第一步：事务持久化控制意图、递增scope的controlEpoch、冻结匹配队列。
第二步：收集实际运行树，发送目标版本公开取消/中断。
第三步：等待并核对子孙、工具job和inbox；返回逐项真实结果。
第四步：持久记录终态、部分成果和可继续入口。

不能把received/accepted回执当作已停止。展示“正在停止”“部分停止”“无法确认”。后台活跃计数来自Windows权威投影，不因主助理idle或网络断开清零。

## 6. DSH适配要核实的事实

已读官方文档：
- Agent.cancel(cause)取消当前活动；未配置keepInbox时还可能清待处理输入。需要按实际签名处理，不能误删其他workIntent的用户排队消息。
- whenIdle只说明Agent停稳，不证明独立job/外部动作全部已停止。
- 受管理subagent发布后的取消需要操作activation句柄，并等待后代清理。初始调用AbortSignal不等于发布后的全部取消。
- job具有owner Session；主助理不能只拿job ID就跨owner控制。Host须通过正确worker所有权调用公开控制接口。
- 普通Session取消要求live状态，冷/已结束/不可达状态分别处理，不能为了取消而恢复并重新启动旧工作。

资料：
https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/agent/README.zh.md
https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/subagent/subagent/README.zh.md
https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/jobs/jobs/README.zh.md
https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/api/session-controller/README.zh.md

施工前核对实际安装版本的生成类型与导出。不得把这些概念名称臆造成endpoint。不要用dispose整个用户Session或关闭Windows DSH代替停止一个Run。

## 7. 竞态、外部副作用与保证边界

- queue/start竞态：调度领取、Agent创建和新工具准入必须检查controlEpoch；停止已持久化后不再接纳该范围的新派发。
- 子孙在停止过程中创建：继承根workIntent和epoch；要么拒绝创建，要么纳入同一取消收敛，不出现漏网子任务。
- complete/stop竞态：以Windows事务/事件序为准。完成先提交则报告already_terminal；stop先提交则迟到结果作为部分/迟到成果保存，不能覆盖停止状态并自动宣称任务完成。
- 不可取消工具：保留停止中/无法确认，展示具体工具和超时。已提交的发邮件、发布、付款不能由Stop撤回，必须报告事实。
- 不保证“点击后物理上立刻没有任何变化”。已经开始或已经提交的副作用可能结束；保证控制回执真实、新派发受门禁约束、剩余动作可追踪。
- 强制结束只针对本Run拥有的可识别进程，不能通杀node/electron；风险与范围明确，不能默认执行。
- 停止期间待审批失效，旧批准不能启动新动作；不能先收到Stop又消耗迟到的允许审批。

## 8. 网络与客户端

Mac退出/断线默认不停止Windows工作；显式Stop是独立命令。
离线点击Stop：显示未送达/待确认，不能显示已停止。可以保留带commandId、hostId和明确目标ID的待送控制；重连后幂等重试并查询结果。
离线“全停”只能清楚说明已知目标集合；不能日后把新开启且用户未看过的工作无条件纳入一个陈旧命令。
旧连接、旧profile、旧generation的控制响应不能覆盖当前页面；设备撤销后控制被拒绝。
控制数据不依赖主聊天上下文是否完整。

## 9. 主动维护任务卡

工作入口先生成/解析workIntent，再匹配已有事项，最后派发。用户直接说“继续某项目”也走这一链路：
识别项目 → 读取项目简报/活跃卡与增量变化 → 续上已有任务或登记本次工作 → 执行。
不要求用户先选卡，不对所有闲聊建卡，小修改可归已有任务活动。

任务状态更新来自真实执行事件、用户决定、项目Agent的结构化交接和明确验收规则。
Host自动维护受理、运行、等待、停止等机械状态；模型负责任务匹配、目标变化与语义验收。
worker不能绕过Host规则直接把建议done写成最终完成。
完成任务默认退出活跃列表，可在历史恢复，不删除记录。
对客观可验收任务支持配置自动完成；主观选择进入待确认，不强迫所有小任务逐卡人工验收。

项目Agent提交带来源与revision的增量：本轮做了什么、成果、卡点、下一步、任务变化。
主助理读紧凑项目概览和待处理队列，不每次扫描全部项目。
外部工具改变项目文件时先标记需核对，再局部读取；不能凭文件时间就关闭任务。

## 10. 交接体验

主界面保持一个逻辑助理入口，隐藏日常新建/换会话流程。
底层可以压缩或轮换；轮换前保存当前目标、决定、pending输入、工作控制状态、结果Outbox与来源。
工作控制、Run与结果不绑定旧主Session；主Session换代期间Stop仍生效。
新Session激活成功再切绑定，旧历史可追溯。不能随机换数据库Session ID冒充交接。
无法无损保留所有闲聊细节；关键工作事实优先结构化持久化。偶发歧义一次澄清，不能由用户手抄交接。
