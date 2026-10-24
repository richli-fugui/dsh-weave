# 轮次记录：20261023-2200-remote-contract

## 1. 身份与输入

- projectId / 实际绝对根目录：dsh-table / <LOCAL_PATH>
- roundId / 开始与结束时间：20261023-2200-remote-contract / 开始 2026-10-23T20:49+08:00 左右，结束 2026-10-23T21:4x+08:00（Asia/Shanghai）
- Agent或工具 / 模型：workbuddy-session（主会话直接执行）；真实模型调用经本地桥接端点（TEST_REAL_LLM=true）
- 上一轮记录路径：handoff/rounds/20261023-1636-continuity-review.md
- 输入版本：Git 仓库仍无任何提交（全部 untracked）。输入时实测关键哈希与上一轮记录**完全一致**：
  - src/index.ts FADFA953…、src/host/services/domain.ts F80EDC31…、src/host/services/context.ts 3B3DDB2B…、lib/index.js 380C35EA…、.artifacts 包 896140AB…
  - 部署副本 lib/index.js 与工作区一致（380C35EA…）
- 占用文件：本轮开始时未创建 handoff/.active.json（流程瑕疵，已核实当时无占用、无他人未提交改动；收尾阶段补建并释放，下轮应一开始就建）
- 本轮目标及对应计划阶段：T-007 可独立推进部分——RemoteProvider 对齐 0.1-draft 联合契约 + S2 形态等价性验证；顺带关闭 T-010（脱敏鉴权说明）

## 2. 对上一轮的独立审核

| 上轮主张 | 本轮复核动作与证据 | 结论 |
| --- | --- | --- |
| 6 处连续性修复已落盘 | 逐处读源码：domain.ts listChatMessages DESC+reverse（590–594 行）、context.ts sessionVerifier 真实接线（245–250 行）、index.ts 按 ID 过滤+分支共享历史（383/435/566 行） | 成立 |
| 全量 50 项（49 过 + 1 门禁跳过）、typecheck 通过 | 本轮重跑：50 项 49 过 + 1 跳过，typecheck 0 | 成立 |
| 部署副本与工作区一致 | sha256 逐文件比对 | 成立（修改前一致） |
| 种子 rootPath「改为相对标识 'dsh-table'」 | 读 src/index.ts 202–217 行：实际实现为 `DSH_WORKBENCH_DEFAULT_ROOT` env 覆盖 + `os.homedir()/.dsh/workbench/workspace` 中性目录 | **记录漂移**：实现本身合理（无硬编码个人路径），但描述与代码不符；本轮按实际实现更正记录 |
| T-008：运行时 DB proj-default root_path 为个人绝对路径 | 只读查询 <LOCAL_PATH>`<LOCAL_PATH>`；runs=0、tasks=2、chat_messages=0 | 成立，保持待用户决策 |
| T-009：宿主需重启才加载新 lib | 本轮未重启宿主（需用户），状态不变 | 保持开放 |

上一轮的修复全部保留，未重做。

## 3. 本轮实现与理由

| 文件/模块 | 改了什么 | 为什么 | 替代/取舍 | 回滚 |
| --- | --- | --- | --- | --- |
| src/providers/remote.ts | 重写 RemoteProvider：①`WORKBENCH_REMOTE_CONTRACT_VERSION='0.1-draft'` + `negotiate()` 身份/版本协商（首次调用前自动触发）；②契约错误词表 `mapWireError`（AUTH_REQUIRED/OFFLINE/UNSUPPORTED_VERSION/UNSUPPORTED_CAPABILITY/CONFLICT/UNKNOWN_OUTCOME/CANCELLED/DOMAIN_ERROR）；③所有写命令自动注入 clientRequestId（startRun 业务键原样透传）；④generation 变化自动失效旧 follow 订阅并作废身份、下次调用重新协商；⑤followEvents 按 sequence 去重单调推进；⑥checkReady 先判 auth_required 再判 offline | 上一轮审核确认 RemoteProvider 只是裸 invoke，不符合双方 0.1-draft 契约的核心要求（版本协商、错误分类、幂等、generation 失效）；这是 T-007 中唯一不需要 Mac/对端即可推进的部分 | 对端未实现身份端点时进入「未验证兼容模式」（如实标注 verified=false/compatMode=true），不冒充已验证——与上轮 sessionVerifier 自管模式同一设计哲学，保证旧 stub 与渐进升级可用 | 单文件重写；回滚=用备份 <LOCAL_PATH>|
| tests/remote_contract.test.mjs | 新增 Gate 5b 共 9 个子测试：契约版本工具函数、S2 Local/Remote 等价性（项目→依赖任务→开工→完成→解锁B 双路对比）、不兼容版本硬阻塞且无副作用、纯 stub 兼容模式标注、auth_required/offline 区分、clientRequestId 注入+透传+不自动重发、CONFLICT 映射与 expectedRevision、generation 失效与重新协商、事件去重 | 契约符合性必须先在替身层固定语义；S2 是 dsh-remoteconnect WORKBENCH_INTEGRATION.md 明确的联调验收项，替身实现是真实联调前置 | 无 | 纯新增 |
| docs/BRIDGE_AUTH.md | 新增脱敏鉴权说明：端点、配置来源优先级（config → env → ~/.dsh/.credentials.yaml）、测试门禁、能力边界披露 | 关闭 T-010（上轮遗留）；不含任何凭据值 | 无 | 纯新增 |
| src/providers/remote.ts checkReady 顺序 | 修复：auth_required 判定优先于 isReady() | 首轮实现里 isReady() 通过就直接放行，auth_required 状态会被漏掉——被自己的测试 5 抓出后修正 | 无 | 同上 |

- 实际完成：上述全部；npm run build；typecheck；全量 60 项（59 过 + 1 门禁跳过）；真实模型 5/5；npm pack；备份后文件级同步部署并逐文件哈希核对（60 lib + 4 包文件全 match）；部署副本 require 冒烟（18 导出，含新契约符号）。
- 尚未实现：真实 dsh-remoteconnect 对端联调（S1/S3–S6）、真实桌面 UI（T-006）、真实宿主停止/恢复对账（T-003）、宿主重启后连续性复验（T-009）、T-008 决策。
- 接口变化：RemoteProvider 新增 `negotiate()`/`getIdentity()`/`isContractCompatible`/`WORKBENCH_REMOTE_CONTRACT_VERSION` 导出；RemoteConnectionAdapter 新增可选 `getState?()`/`onGenerationChange?()`；既有构造签名与 WorkbenchProvider 接口不变，向后兼容。
- 新增依赖：零。

## 4. 验证记录

| case | 版本/包 | 证据层 | 命令 | 预期/实测 | 结论 |
| --- | --- | --- | --- | --- | --- |
| 契约符合性 9 子测试 | 本轮 lib | UNIT/MOCK（stub 适配器） | node --test tests/remote_contract.test.mjs | 10/10 过（含父级） | PASS |
| S2 等价性 | 本轮 lib | UNIT/MOCK | 同上子测试 2 | Local/Remote 双路领域可观测结果一致；远端写入真实落 Windows 侧 DB | PASS（替身层） |
| 全量回归 | 本轮 lib | UNIT/MOCK | node --test tests/*.test.mjs | 60 项：59 过 + 1 门禁跳过，0 失败 | PASS |
| 类型检查 | 本轮 src | STATIC | npm run typecheck | 退出码 0 | PASS |
| 真实模型集成 | 本轮 lib | MODEL（本地桥接端点真实调用） | TEST_REAL_LLM=true node --test tests/host_ai_integration.test.mjs | 5/5 通过 | PASS |
| 打包与部署一致性 | dsh-table-0.1.0.tgz（SHA-256 1E1485E7…） | HOST 部署物 | npm pack；部署副本 vs 工作区 60+4 文件逐一 sha256 | 64/64 match | PASS |
| 部署副本加载 | 已部署 lib | HOST | node require 部署 index.js | 18 导出，含新契约符号 | PASS（加载级；宿主进程仍运行旧代码，见 T-009） |
| 真实 dsh-remoteconnect 对端联调 | — | REMOTE | 未执行（对端 0.1-draft 亦未冻结实现） | — | NOT_RUN/BLOCKED |
| 真实桌面 UI / 宿主停止恢复 / 跨设备 | — | DESKTOP/REMOTE | 未执行 | — | NOT_RUN |

- 开发中被测试抓出的真实缺陷（保留过程证据）：①checkReady 漏判 auth_required；②契约族版本提取 `split('-').slice(0,2).join('-')` 错误保留限定词（'0.1-rc2' 被误判不兼容）；③等价性测试自身给双路使用不同 clientRequestId 导致误报（测试设计错误，非产品缺陷）。三者均已修复并复测。
- 部署校验脚本第一版相对路径计算错误产生假 MISSING 输出，未影响实际部署（robocopy 已正确完成），已用正确比对复验 64/64。

## 5. 版本与部署

- 修改后关键文件 SHA-256：
  - src/providers/remote.ts A51364BA951E767FA23561E92475024A4D372A1C699893A80FAAC5B4D0E2E771
  - lib/providers/remote.js E7082EE681615ED150C109D20A8B00BE3EE15A9EFA9091827EBA3DF0FBB46BF6
  - tests/remote_contract.test.mjs F4CD2960EAD16A8AA0B36F45F2603BFDD6B9D2E2160AB5CE912A7A3F286F00FB
  - docs/BRIDGE_AUTH.md 2453D4BC8BBC21DF2BF1B26EFF313AD3757B69C607D012A4951FFE0C6E786E49
- 包：.artifacts/dsh-table-0.1.0.tgz，SHA-256 1E1485E709A3E0A0050AF720630125F96FD668FE7AF4218779F55EEB235AB671
- 部署：<LOCAL_PATH>
- 同步前活跃任务核对：运行时 DB runs=0、queue 无表、tasks=2、chat_messages=0——无活跃工作被中断
- Git：未 commit/push（遵守边界）；Mac 端到端 BLOCKED/NOT_RUN

## 6. 开放问题与下一位的具体动作

| 优先级 | ID | 事实与来源 | 下一步 | 完成证据 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| 高 | T-007 | RemoteProvider 已按 0.1-draft 契约实现并通过替身层 9 项；**真实对端联调未做**（对端项目 0.1-draft 文件仍为草案） | dsh-remoteconnect 侧实现 identity/invoke/follow stub（S1），再与本端 RemoteProvider 对跑 S2/S3 | 双端版本化声明 + 脱敏 correlation ID 记录 | 对端项目施工 |
| 高 | T-009 | 宿主进程仍运行旧 lib（本轮再次热同步，仍需重启） | 用户重启 DSH 宿主后：>10 条历史 + 指代「刚才那个」真实入口对话；并确认 RemoteProvider 新代码被加载 | 宿主层连续性 + 加载版本记录 | 需用户重启 |
| 高 | T-002/T-003/T-005 | 真实宿主业务受理、停止/恢复对账、门禁口径刷新均未做 | 真实宿主内发业务请求与停 A 保 B 对账 | 宿主运行记录 | 需真实宿主会话 |
| 中 | T-006 | 真实桌面操作说明可达性未验证 | 按说明逐步操作 | 每步记录 | 需真实桌面 |
| 中 | T-008 | 运行时 DB proj-default root_path 为个人绝对路径（本轮只读复核确认；runs=0 无活跃风险） | 用户确认后：备份 workbench.db → 一次性中性化迁移（或接受现状） | DB 行与播种策略一致 | 需用户确认 |
| 低 | T-010 | 已关闭：docs/BRIDGE_AUTH.md（脱敏，不含凭据） | — | — | — |

- 下一位第一条可执行动作：读 03-STATE 与本记录 → 优先取 T-009/T-003/T-002 的真实宿主证据（需用户重启宿主配合）；拿不到宿主条件时，推进 dsh-remoteconnect 侧 S1 stub（跨项目协作需遵守对方项目边界）或本端补 budget/pagination 边界负例。
- 需要用户参与：(1) 重启 DSH 宿主（T-009，重启后本轮 RemoteProvider 契约代码才在宿主生效）；(2) T-008 中性化决策。其余自行推进。

## 7. 交接自查

- [x] 已独立审核上一轮（2 项成立复核 + 1 项记录漂移更正：种子 rootPath 描述）
- [x] 已记录实际变更、理由、未完成部分与回滚
- [x] 03-STATE 已更新，04-LOG 已追加，旧状态漂移已更正
- [x] 证据分层标注：STATIC/UNIT/MOCK/MODEL/HOST(加载级)/DESKTOP/REMOTE 分开；替身通过不冒充真实联调
- [x] 保留他人改动；未 commit/push；公开记录不含凭据与私人材料
- [x] 流程瑕疵如实记录：占用文件未在开工时创建（当时已核实无占用），收尾补建并释放
