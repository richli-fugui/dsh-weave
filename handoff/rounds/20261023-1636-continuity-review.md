# 轮次记录：20261023-1636-continuity-review

## 1. 身份与输入
- projectId / 实际绝对根目录：dsh-table / <LOCAL_PATH>
- roundId / 开始与结束时间：20261023-1636-continuity-review / 开始 2026-10-23T16:36:48+08:00，结束 2026-10-23T17:50+08:00（Asia/Shanghai）
- Agent或工具 / 模型（工具实际可见才填写）：workbuddy-<SESSION_ID>（主会话直接执行）
- 上一轮记录路径：handoff/rounds/20261023-000-bootstrap.md
- 输入版本：Git 仓库无任何提交（全部文件 untracked，等效 uncommitted/dirty）。输入时关键文件 SHA-256：
  - src/index.ts 019DCAE9AAED0D78936316E2176CF737E8EF355F39EBC58C7624DFF7741C3309（本轮修改前）
  - 输入包 .artifacts/dsh-table-0.1.0.tgz：03-STATE 记录为 56CD9EDBE7FA938B000815E7BD508FD5C3E9AA207A84179550A347711AD6FFA6，但审核时实测为 5e51b5c0…（记录与文件不符，说明上上轮写过状态文档后包被重建过，见第 2 节）
- 当前占用文件 owner / 本轮允许写入范围：owner=workbuddy-<SESSION_ID>（本轮创建 handoff/.active.json）；范围：src/、lib/、tests/、handoff/rounds/、handoff/03-STATE.md、handoff/04-LOG.md、docs/、validation/、.artifacts/
- 本轮目标及对应计划阶段：独立审核上一轮结论 → 修复连续性真实缺陷（T1/T4/T5）→ 验证（含真实模型）→ 重建部署 → 完整交接

## 2. 对上一轮的独立审核

| 上轮主张/问题 | 本轮复核动作与证据 | 结论 | 是否需修复 |
| --- | --- | --- | --- |
| T-001"最近 src/index.ts 已加入部分近期历史，连续性尚待复核" | 读 src/index.ts 步骤 8 与讨论分支；实测 >100 条消息场景 | 部分成立：步骤 8 有历史，但分页取最早 N 条、按文本去重误删、讨论分支不带历史 | 是（已修） |
| A15"部署副本与工作区一致" | sha256 逐文件比对 lib/index.js 及 4 个 service 文件 | 成立（修改前已一致） | 否 |
| "桥接端点在线" | curl http://127.0.0.1:8787/v1/models | 成立：在线，返回 401（需鉴权） | 否 |
| "43 项测试 42 通过 1 门禁跳过" | node --test tests/ 重跑 | 成立 | 否 |
| T-004"context.ts 已增加裁剪与交接字段；仍见合成 Session ID 路径" | 读 context.ts rotateSession 全文 | 部分成立：裁剪存在但尾注突破预算；sessionVerifier 是从不执行的死参数，"严格验证新 Session 可用性"的注释名不副实 | 是（已修） |
| 03-STATE 包哈希 56CD9EDB… | sha256sum 实测 .artifacts/dsh-table-0.1.0.tgz | 不成立（记录漂移）：实测 5e51b5c0…，候选包在上上轮写文档后被重建 | 更正记录（已更正） |
| T-006/T-007 未验证项 | 本轮未做真实桌面/跨设备操作 | 未验证（保持开放） | 否（留给后续轮次） |

真实调用与替身边界：真实模型调用通过本地桥接端点完成（TEST_REAL_LLM=true，5/5 通过）；其余为替身/模拟。真实 DSH 宿主业务受理、真实桌面 UI 点击、真实跨设备（Mac）本轮未执行，相关结论一律标 NOT_RUN，不用替身结果推导。

## 3. 本轮实现与理由

| 文件/模块 | 改了什么 | 为什么这样改 | 替代方案/取舍 | 影响与回滚 |
| --- | --- | --- | --- | --- |
| src/host/services/domain.ts | listChatMessages 由 `ORDER BY created_at ASC LIMIT ?` 改为先 `DESC LIMIT ?` 再反转，返回"最新 N 条、时间正序" | 旧语义取最早 N 条：消息超限后最新事实被截断，主助理"失忆"，直接违背 T1 | 也可加 created_at 游标分页；当前调用方只要 tail-N，DESC+reverse 最简 | 接口签名不变；回滚=还原单条 SQL |
| src/host/services/context.ts | 预算裁剪：①地板由 5 行改为 4 行（核心身份块 4 行永不参与裁剪）②TRIM_NOTE 纳入重新核算循环，与正文一起满足 maxPromptTokens | 旧代码尾注在核算后无条件追加，可突破 maxPromptTokens；地板 5 行会多留一个"【当前引用的任务详情】"空壳头 | 身份+尾注存在不可约下限（实测 81 token），预算低于下限时如实返回并在注释声明，由调用方设合理预算 | buildBoundedContext 行为在预算充足时不变；回滚=还原两处循环 |
| src/host/services/context.ts | rotateSession 真正调用 sessionVerifier：提供则必须返回可用（支持 Promise），不可用抛 ValidationError；不提供则维持 self-managed 并如实记录 | 旧代码声明"严格验证新 Session 可用性"但参数从未执行，是名不副实的死参数 | 也可默认内置 verifier；当前保持可选注入，避免依赖未接通宿主 | HandoverRecord 增加 verifierUsed 字段；测试中同步改 async |
| src/index.ts | 历史过滤由"文本不同"改为"ID 不同"（m.id !== currentId） | 旧逻辑 `m.text !== userText \|\| m.sender !== 'user'` 会把所有早期同文用户消息全部删除（如重复提问），误删合法历史 | 也可仅过滤最后一条；ID 过滤最精确 | 主问答与讨论分支共享同一 assembled previousHistory |
| src/index.ts | 讨论分支（"讨论/方案/如何"意图）改为与主问答分支共享同一份有界历史组装 | 旧讨论分支只发 system+user 两条，"按刚才要求改一下"在讨论中失效 | 无（合并组装是唯一合理解） | 两分支行为一致 |
| src/index.ts | 种子项目 rootPath 由个人绝对路径 `<LOCAL_PATH>` 改为相对标识 'dsh-table' | 个人绝对路径写进产品代码不可移植、泄露环境信息 | 也可用 process.cwd()；相对标识在 DB 中保持中性，需要时由宿主解析 | 仅影响空库首次播种；已存在 DB 行不受影响（见开放问题 T-008） |
| tests/continuity_history.test.mjs | 新增 7 个子测试：>100 条取最新、重复同文保留、讨论分支共享历史、预算尾注不超限（85–400 扫描）、rotateSession verifier 接线 | 先对旧代码运行确认 7/7 失败（bug 证据），修复后 7/7 通过 | 无 | 纯新增测试文件 |
| tests/scheduler_context.test.mjs | "3. 会话轮换"机械跟随 rotateSession 变 async（加 await） | 接口变更的机械同步，非降低断言 | 无 | 无 |

- 实际完成：上述全部修改；npm run build；typecheck；全量测试 50 项（49 通过 + 1 门禁跳过）；真实模型集成 5/5；打包（SHA-256 见第 5 节）；备份后同步部署并 60/60 文件哈希校验；部署副本 require 冒烟通过。
- 尚未实现：真实桌面 UI 端到端（T-006）、真实跨设备（T-007）、真实宿主对停止范围/恢复的复验（T-003）、真实宿主读取项目材料并产出内容（T-002）。
- 与既定目标或接口有无差异：无公开接口破坏；rotateSession 返回 Promise 属内部 API 演进，已同步测试。
- 新增依赖、运行成本、维护影响：零新增依赖。
- 数据 schema 或公开接口变化及迁移/兼容：HandoverRecord 加 verifierUsed 字段（可选，向后兼容）；chat_messages 无 schema 变化。
- 外部模型/宿主服务的具体依赖，是否可选：模型调用经本地桥接端点，缺失时走降级回复；宿主 SessionController 可选注入。

## 4. 验证记录

| case/用户故事 | 候选版本/包哈希 | 环境及真实证据层 | 操作/命令与退出码 | 预期与实测 | PASS/FAIL/BLOCKED/NOT_RUN | 脱敏证据路径 |
| --- | --- | --- | --- | --- | --- | --- |
| >100 条历史取最新 | 修复前 lib | 本机替身（node:test） | node --test tests/continuity_history.test.mjs | 修复前 7/7 FAIL（含"期望最后一条=msg-120 实际=msg-1"） | FAIL→修复后 PASS | tests/continuity_history.test.mjs |
| 全量回归 | 修复后 lib | 本机替身 | node --test tests/*.test.mjs | 50 项：49 通过 + 1 门禁跳过 | PASS | — |
| 类型检查 | 修复后 src | 本机 | npm run typecheck | 退出码 0 | PASS | — |
| 真实模型集成 | 修复后 lib | 真实模型层（本地桥接端点，需鉴权） | TEST_REAL_LLM=true node --test tests/host_ai_integration.test.mjs | 5/5 通过 | PASS | — |
| 打包一致性 | dsh-table-0.1.0.tgz | 本机 | npm pack；60 文件逐一 sha256 | 60/60 match，0 diff，0 missing | PASS | .artifacts/dsh-table-0.1.0.tgz |
| 部署副本加载 | 已部署 lib | 真实 DSH profile | node -e require('…/profiles/desktop/node_modules/dsh-table/lib/index.js') | 导出 15 个符号（含 WorkbenchContextManager/WorkbenchDomain/TaskScheduler/DshAIClient） | PASS | — |
| 真实桌面 UI 端到端 | — | 真实桌面层 | 未执行 | — | NOT_RUN | — |
| 真实跨设备（Mac） | — | 跨设备层 | 未执行 | — | NOT_RUN | — |
| 真实宿主停止/恢复对账 | — | 真实宿主层 | 未执行（运行时 DB runs/queue 均为空，无活跃任务可对账） | — | NOT_RUN | — |

- 实际运行命令、工作目录、时间和结果：均在 <LOCAL_PATH>
- 替身/模拟服务有哪些：全部单元/集成测试替身；真实模型层经桥接端点真实调用（非替身）。
- 本轮未执行的真实步骤：真实桌面点击、真实宿主业务受理、跨设备。
- 关键负例：预算下限 81 token（身份 62 + 尾注 19）处行为如实返回不伪造通过；桥接端点 401 属预期鉴权状态，已在真实模型测试中带凭据通过。
- 失败后修复了什么：第一轮修复后测试仍暴露地板多留 1 行（身份块实为 4 行），二次修复地板 4→身份行数后全绿。
- 不得把"没有执行"写成零失败全通过：桌面/跨设备/宿主停止恢复均标 NOT_RUN。

## 5. 版本与部署
- 修改后关键文件 SHA-256 / 构建时间（2026-10-23 17:0x，npm run build）：
  - src/index.ts fadfa9536f57a6a03d041b76aca0400f9e86c2ee4dc8886e5ba16e89b4226436
  - src/host/services/domain.ts f80edc31eeb236aba7eec21da510d889c50fb5c72838d14137bddf67b3d68669
  - src/host/services/context.ts 3b3ddb2bd1cdff347aef90962cf6a77243db1c7fc61cacf9ba4c308503bb062f
  - lib/index.js 380c35eab25f6381c791aadc6fcd915a6764c380d5a6bef6ebb1f66bb07e4f16
- 包名、版本、SHA-256：dsh-table@0.1.0 / .artifacts/dsh-table-0.1.0.tgz / 896140abb78444c6a8315d286c129475b201e20260d72cf04989fe0d047eab73
- 实际安装目标/profile/模式：<LOCAL_PATH>
- 安装文件与候选包是否一致：一致（60/60 sha256）；运行时加载版本如何确认：部署副本 require 冒烟 + 导出符号核对；宿主进程运行中采用热更，**新 lib 在宿主重启后生效**，重启后真实桌面行为本轮未复验（NOT_RUN）
- 活跃任务处理：同步前只读核对运行时 DB（runs/queue 均为空），无活跃任务被中断；备份：<LOCAL_PATH>
- 公开记录不含凭据或私人业务内容：已遵守（桥接端点仅记地址与 401 状态）

## 6. 开放问题与下一位的具体动作

| 优先级 | 问题ID | 事实与来源 | 下一步动作 | 完成时必须看到的证据 | 依赖/阻塞 |
| --- | --- | --- | --- | --- | --- |
| 高 | T-002 | 真实模型已通；真实宿主读取项目材料并产出对应内容未验证 | 用真实安装包在真实宿主发一次"读取项目材料并产出"的业务请求 | 宿主侧运行记录 + 产出内容与材料对应 | 需要真实宿主会话 |
| 高 | T-003 | 停止/恢复代码在，但真实宿主窗口对账未做 | 真实宿主内只停 A 保留 B、A 重新排队后续跑 | 对账截图/日志：B 未停、A 恰好再执行一次 | 需要真实宿主会话 |
| 高 | T-005 | 门禁跳过项统计口径要随真实运行刷新 | 真实条件下重跑集成套件，逐项记 PASS/SKIP/BLOCKED | 不得再用替身数量冒充宿主通过 | 需要真实宿主会话 |
| 中 | T-006 | 用户操作说明含"编辑任务目标"，真实 UI 是否可达未验证 | 按说明在真实桌面逐步操作：材料输入/编辑、引用、结果查看 | 每步真实可达的操作记录 | 需要真实桌面 |
| 中 | T-007 | RemoteProvider 仍为 stub | 版本化契约联调 + 同一 Windows 状态 + Mac 证据 | 契约测试与真实两端记录 | 需要对端环境 |
| 中 | T-008 | 运行时 DB 已存在 proj-default，root_path 为旧代码播种的个人绝对路径（本机恰好有效，但不可移植） | 决定：接受本机现状 / 增加一次性中性化迁移；若迁移需先备份 workbench.db | DB 行与代码播种策略一致 | 需用户确认是否动运行时 DB |
| 中 | T-009 | 宿主进程仍在运行旧 lib，热更后未重启 | 重启 DSH 宿主后用真实入口发一轮对话，确认新 lib 生效（历史连续性） | 宿主重启后 >100 条历史的场景实测 | 需要用户重启宿主 |

- 下一位第一条可执行动作：先读 03-STATE 与本记录；然后按 T-009 在真实宿主重启后做一轮"连续指代"真实对话（>10 条历史 + 指代"刚才那个"），取得宿主层证据；拿不到宿主条件就继续推进 T-008 决策或 T-002/T-003 的替身边界负例。
- 可并行推进的独立事项：语义/控制领域负例、预算与分页边界、UI 材料入口的替身级验证；RemoteProvider 契约草案。
- 需要用户参与吗：有——(1) 重启 DSH 宿主使新 lib 生效（T-009）；(2) 确认是否允许对运行时 DB 的 proj-default 做路径中性化（T-008）。其余自行推进。
- 新发现但不属于本轮范围的事项：桥接端点 401 的鉴权配置方式未记录在案（测试用凭据来源未文档化），建议后续补一份脱敏说明。

## 7. 交接自查
- [x] 已独立审核上一轮，说明证据和不同意见（第 2 节含 3 项"不成立/部分成立"更正）
- [x] 已记录实际变更、设计理由和未完成部分（第 3 节）
- [x] 03-STATE 已更新，04-LOG 已追加，相关旧状态已校正（包哈希漂移已更正）
- [x] 证据绑定当前版本；模拟、模型、宿主、桌面和跨设备分开标注
- [x] 保留他人改动；释放本轮自有占用（handoff/.active.json 已删除）；未擅自提交或发布
