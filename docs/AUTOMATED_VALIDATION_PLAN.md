# 自动化验证体系与试用关卡

日期：2026-10-23。与CONTROL_AND_AUTONOMY.md、validation/scenarios.json一起使用。

## 1. 本次交付与边界

本次提供：
- 明确的工作控制/自动维护语义；
- 结构化场景目录、独立不变量、可重复的生成策略；
- 可直接运行的目录静态检查器；
- 对后续Agent的验证框架施工要求与进入真人试用的条件。

场景目录是待实现验收规格，不是已经执行的测试。静态检查器只检查目录结构与覆盖声明，不能证明产品功能通过。禁止将它的成功显示为144项功能PASS。

不可能穷尽所有人类表达与操作序列；使用固定真实故事、状态机生成、故障注入、变异测试和有限真人试用共同降低遗漏。

## 2. 测试层级

| 层 | 运行对象 | 用途 | 可以宣称 |
| --- | --- | --- | --- |
| L0 规格检查 | catalog与schema | 检查ID、步骤、oracle与覆盖，零模型调用 | 规格有效 |
| L1 确定性模型测试 | 独立参考状态机+SUT Domain/调度适配器 | 大量顺序、并发、故障、时钟用例 | 领域与控制语义通过 |
| L2 真DSH集成 | 隔离profile中的真实插件、Agent/Session/job | 验证取消、审批、生成、工具效果与恢复 | 目标DSH集成通过 |
| L3 桌面/远程 | 真Windows与Mac DSH、真实通道 | 入口、输入法、控制、合盖和网络 | 指定设备链路通过 |
| L4 真人试用 | 小范围办公工作 | 主观可理解性、指代和实际负担 | 试用反馈，不替代L1-L3 |

开发时尽早进入L2做一条最小真实链路，不等界面全部完成才发现API不存在。用户不用充当第一轮单元/集成测试员。

## 3. 测试框架施工结构（后续实现）

tests/validation/model：与生产代码独立的业务/控制参考模型。
tests/validation/drivers：Domain、DSH、Desktop、Remote四种适配器。
tests/validation/fixtures：临时项目、文档、任务、确定性worker和可取消工具。
tests/validation/generators：状态序列、故障切点、语音变体。
tests/validation/oracles：独立观测与不变量。
tests/validation/reports：结构化结果、trace与最小失败重放。

实际目录可按上游构建工具调整，但职责分离。禁止测试从生产状态函数读取一个布尔值，然后据此证明该状态函数正确。

catalog里的op是待实现的动作协议。任何未实现fixture/op/oracle必须报NOT_IMPLEMENTED/BLOCKED并使相应关卡失败，不能跳过后PASS。真正执行器完成后再增加package脚本，不能预先伪装已有npm命令。

## 4. 控制/事件状态机与组合覆盖

参考模型至少包含：
- 主助理：idle/generating/dispatching/rotating/unavailable；
- workIntent：draft/accepted/queued/running/awaiting_input/stopping/stopped/completed/unknown；
- worker：not_created/creating/running/waiting_tool/waiting_approval/stopping/terminal；
- connection：online/degraded/offline/reconnecting/revoked；
- task：active/paused/review/done/cancelled，具体映射按最终schema；
- control scope：current_intent/run/batch/project/all_workbench；
- tool：cancellable/non_cancellable/external_committed；
- callback ordering：normal/delayed/duplicated/reordered/lost。

生成器先做可达状态的pairwise覆盖，再做随机长序列。建议日常CI固定20个seed，每seed不少于50步；深度回归100个seed×100步，可配置预算。固定随机种子并输出重放trace，失败要缩减为最短触发序列。

重点覆盖边：dispatch↔stop、child-create↔stop、approve↔stop、complete↔stop、rotate↔input、commit↔ACK-loss、reconnect↔late-response、resume↔old-result。

程序层故障用精确cutpoint/barrier，不用“sleep 50ms大概会碰到”。L1用虚拟时钟推进，L2有界等待真实事件。

## 5. 独立oracle与证据

必须同时观察：
1. Host事务/领域事件及controlEpoch；
2. 实际DSH Session/activation/job状态与身份；
3. 测试工具的真实开始/结束/取消与写入计数；
4. 项目文件内容/hash及路径边界；
5. UI可见控制、状态文字、消息历史；
6. API回执、correlation ID、generation与时间；
7. 进程/socket/订阅资源。

模型说“已停止”“已完成”“已记住”不是证据。HTTP200、Run表有一行、generation数字变化也不是端到端证据。
工具写入计数可以用无害临时文件、可取消计数器和本机假外部投递服务器验证，不发真实邮件/发布/付款。

## 6. 故障注入

可复现注入：延迟/重复/丢弃ACK、重排结果、断开流、网络分区、慢工具、取消不响应、Host崩溃、数据库只读/磁盘满、迁移失败、旧generation事件、审批重复、多客户端冲突。
所有破坏性故障先在隔离profile和临时项目；不杀用户正式DSH、不读私人凭据、不更改用户项目成果。

Stop必须验证：
- 主助理已经idle仍可按；
- 不经过LLM也能到Host；
- 队列门禁立即生效；
- 目标树收敛，未涉及的工作保持；
- 不可取消/已提交动作被如实展示；
- 离线未送达不冒充已停止；
- Stop与完成竞态有可重复规则。

## 7. 真实语言与办公任务

catalog覆盖用户常见语音式输入：长句、多意图、自我纠正、代词、跨项目切换、聊完顺手推进、任务已完成的告知、临时插队、否定“停止”、忘记任务卡、直接说“继续项目”。

确定性模式在模型边界使用受控意图输出，测试程序逻辑。另用真实模型跑小规模语义集，检查项目/任务解析与反问是否合理。不能用脚本模拟模型后宣称自然语言理解已验证。

客观样例用预先标注的任务ID、验收标准和真实文件判分。可选第二模型评价表达是否清楚，但它不能覆盖硬oracle失败。关键安全/状态测试要求零错误；一般语义准确率单独报告样本数、模型、版本和置信限制。

真实模型调用单独开关，预算与次数有上限；默认L0/L1不消耗模型Token。不得为跑回归自动购买额度或切换账户。

## 8. 变异测试：防止“测试自证”

至少人工/自动注入以下缺陷，验证用例会失败：
- 主助理idle时隐藏所有Stop；
- 取消命令收到就把UI设stopped，实际工具还运行；
- 忽略child取消或错用主助理owner杀worker job；
- 忽略controlEpoch，让stop后队列继续派发；
- ACK丢失后重发副作用；
- 用随机Session ID代替真实handoff；
- 直接相信worker建议done；
- Remote模式走LocalProvider；
- 只写Run记录却显示已开工；
- 用固定文本回复替代真实主助理；
- 对未实现op或oracle直接返回PASS；
- 丢弃待审批和结果Outbox。

关键变异必须全部被对应测试识别。变异只作用于测试副本/可控注入，不改用户安装产物。

## 9. 何时开启真实DSH，何时让用户测试

先让施工Agent修复上一轮review问题，接通真实DSH适配器。在隔离profile内尽早启动并安装测试包，不直接让用户在日常实例试错。

进入Windows小范围试用前：
- 真实主对话，不是固定回复；
- 至少一个真实worker执行及回执；
- 独立工作控制/Stop闭环；
- 真实任务状态与结果回写；
- 断线/重启不重复执行；
- schema备份与可回滚安装。

之后才部署用户指定Windows实例，做小规模可恢复试用。Mac试用还需Remote Connect真实链路就绪。Mac缺席只能BLOCKED，不能按全通过。

用户真人试用只需几段自然工作：
1. 直接说“继续项目”，不选卡；
2. 选择两项工作，途中继续聊天；
3. 主助理说完后停止其中一项；
4. 工作过程中改方向/补要求；
5. 离开再回来继续，核对任务状态；
6. 主入口整理上下文后继续上次工作。

把用户的困惑转为新回归用例，避免每次重复手工踩同一问题。

## 10. 报告与关卡

每个case记录caseId、catalogVersion、seed、SUT commit/dirty、包哈希、DSH/OS/模型版本、fixture、真实执行层、步骤trace、oracle结果、证据、耗时、失败/阻塞原因。

状态：PLANNED、NOT_IMPLEMENTED、NOT_RUN、BLOCKED、FAIL、PASS。只有实际执行且所有必需oracle通过才PASS。
分别统计L0/L1/L2/L3，不能把144个规格ID计成144个通过测试。
未定义断言、未执行步骤或缺独立证据时拒绝发布通过报告。

P0阻止日用试用：错范围停止、停止后偷偷继续派发、假停止/假执行、重复副作用、丢用户输入/结果、跨项目文件误写、无可恢复数据或无法识别当前Host。

## 11. 机器自查、修复与回归闭环

日常自查由程序驱动，不需要每次让主助理通读所有项目和日志：

1. 施工Agent完成一个改动，运行受影响的已实现规格和核心回归。
2. 执行器输出失败case、seed、最小重放步骤、期望与实测、事件ID/文件证据；缺实现要报告缺实现。
3. Agent读取这个有限失败包，修复业务或适配代码，再重放同一失败；通过后重新跑相关回归和核心集合。
4. 自动修复最多3轮或达到显式预算即停，保留未解决问题；预算到达不能把失败改为通过。
5. 准备试用时跑声明发布范围内的完整已实现集合及真实DSH链路；Mac另计。

不得通过删除case、弱化oracle、延长所有超时、把真DSH换成mock、静默降低发布范围来消除红灯。规格确有错误时单独记录理由、版本和证据，再运行修订后的用例；旧失败保留。

可先使用仓库现有测试工具加上述driver，不必引入新的多Agent平台。真实模型语义测试按预算少量执行；高频时序、恢复和状态一致性优先用确定性测试。

自动验证不能替用户决定稿件风格是否满意、项目方向是否值得做，或保证任意自然语言都理解准确。这些用少量真人试用补足；反馈转为去隐私的合成fixture和新增回归。外部系统不提供幂等/结果查询时，未知副作用不能无条件自动重试，需明确停留待核对。
