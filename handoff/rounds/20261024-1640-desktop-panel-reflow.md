项目：dsh-table

# 20261024-1640-desktop-panel-reflow

## 1. 身份与输入
- projectId / 实际绝对根目录：dsh-table / `<LOCAL_PATH>`
- roundId / 开始与结束时间：20261024-1640-desktop-panel-reflow / 2026-10-24T15:40:00+08:00 → 2026-10-24T16:45:00+08:00
- Agent或工具 / 模型：Trae CLI Agent；模型标识以会话运行时为准（DeepSeek-V4.1-Flash，客户端可见）
- 上一轮记录路径：[20261024-1445-iso-host-boot](20261024-1445-iso-host-boot.md)
- 输入版本：Git 无提交，全部 untracked（`git status --porcelain` 全为 `??`）。关键输入哈希：`src/index.ts` 起始态、`lib/*` 起始态、候选包 `c2d702252e976a9e8938d755141d0c9a25b480d537da9373dbee89dd71f8fe86`
- 当前占用文件 owner / 本轮允许写入范围：起始时 `handoff/.active.json` 不存在（无他人占用）；本轮自建 owner=`trae-deepseek-20261024`，范围 `src/ tests/ scripts/ handoff/ docs/ evidence/ .artifacts/`
- 本轮目标及对应计划阶段：T-009 收口（desktop 日常实例部署 + 真实桌面验收）+ 主入口体验缺口（后台成果自动回流、一句工作指令自动开工、界面只呈现业务语义）

## 2. 对上一轮的独立审核

| 上轮主张/问题 | 本轮复核动作与证据 | 结论 | 是否需修复 |
| --- | --- | --- | --- |
| 全量回归 85 项：84 过 1 跳过 0 失败 | 本轮开工即跑 `npm test`，实测一致（85 项 / 84 过 / 1 跳过 / 0 失败） | 成立 | 否 |
| 候选包 SHA-256 `c2d70225...` 覆盖上轮候选 | `Get-FileHash .artifacts/dsh-table-0.1.0.tgz` 实测 `c2d70225...` | 成立 | 否 |
| 隔离 profile 真实宿主 11/11 PASS | 复核 `evidence/host-iso-20261024.json` 的 11 条明细；隔离 profile 内已安装包与构建产物哈希一致（`lib/index.js` 比对） | 成立（但为旧包） | 旧包已被本包覆盖 |
| desktop 实例被 dsh-remoteconnect 0.1.0 客户端打包缺陷阻断，无法升级 | 复核 desktop profile：`node_modules/dsh-remoteconnect/lib/client/browser.js` 已无顶层 ESM import；真实重启桌面应用后宿主正常启动、remoteconnect 面板与插件页均可用，`/json/version` 与 CDP 均正常 | **不成立（状态已过期）**：阻塞被 remoteconnect 项目修复，本轮无需再等 | 是：T-009 收口在本轮完成 |
| 桌面面板“点击打不开”风险（客户端只注册侧栏图标） | 读宿主 asar 内契约文档：同一 panel id 必须注册到 root 作用域 `main` keyed slot 才渲染；原实现只注册 `sidebar.panellist` 且用 fixed 覆盖层 | **不成立（确实缺失）**：旧实现点击不会出现工作台 | 是：本轮修复 |
| 主入口体验：后台成果、成果去向是否需要用户追问 | 用真实桌面实例跑 API 流程：后台 Run 结束后主对话无任何回流消息；且明确工作请求（“帮我整理…”）落入通用闲聊分支，不建卡不派发 | **不成立（体验缺口）** | 是：本轮修复 |

说明：上轮实测数据全部成立，未推翻其实现；仅“desktop 被阻塞”的结论因外部项目修复而过期，本轮以真实启动 + 13 项 PASS 更正。

## 3. 本轮实现与理由

| 文件/模块 | 改了什么 | 为什么这样改 | 替代方案/取舍 | 影响与回滚 |
| --- | --- | --- | --- | --- |
| `src/client.tsx` | ① 面板按宿主契约成对注册：`main` keyed slot（内容）+ `sidebar.panellist`（入口图标，点击走 `layout.selectPanel`），移除 fixed 覆盖层改为面板内 `absolute` 铺满；② 入口名改为“任务台”（避免与宿主自带“工作台”重名）；③ 状态/优先级只显示中文业务标签（新增 `taskStatusLabel`/`taskPriorityLabel` 并导出以便回归）；④ 卡片角标由内部 `ID`/`rev` 改为更新时间 | 旧实现只注册图标 → 点击无内容；覆盖层会遮挡宿主 UI；内部码值直接暴露给用户违背“界面只给业务语义” | 取舍：不引入状态管理库、不做视觉重构，只做契约与文案修正 | 纯前端静态改动；回滚=恢复上一版 `lib/client.js`（备份在 `~/.dsh/backups/dsh-table-desktop-20261024-1610/dsh-table-installed`） |
| `src/host/services/domain.ts` | `completeRun` 结束时向主对话写入一条“成果回流”消息：标题按真实结论（已完成（待验收）/执行结束但未达验收/未完成/已停止）、任务名、摘要、前 3 个交付物路径、卡片状态、下一步提示；`completeRun` 幂等保证严格一次 | 用户不应刷新或追问才知道后台结果；“Run 结束≠任务完成”，标题必须与卡片状态一致，不得粉饰 | 取舍：不新建通知系统/不改 Outbox 消费方，直接复用既有 chat_messages 单一事实源 | 仅新增一条 assistant 消息；失败包裹 try/catch 不阻断入库；回滚=移除该块 |
| `src/index.ts`（chat/send） | 新增 7.5 分支：识别保守的明确工作指令（`帮我/请/麻烦/给我/替我` + 整理/总结/起草/分析等动词 + 实质宾语，且非疑问句、长度≥10），自动在既有项目下建卡并走与所有入口一致的 `scheduler.dispatchBatch`；同标题未完成卡复用；复用已收敛卡时先置回 `todo` 再派发（存在未决执行则如实拒绝）；已在执行/排队则不重复派发 | 用户一句工作要求就应该开工，不该先手工建卡或得到泛泛闲聊；重复建卡会污染看板 | 取舍：规则式判定而非模型分类，宁漏不滥（疑问/讨论不入卡），避免误把闲聊变成活跃卡 | 仅影响 chat/send 命中分支；回滚=删除该分支 |
| `src/host/services/context.ts` | 主助理上下文新增一条表达约束：只使用业务语义，内部 ID/修订号/状态码不得原样复述给用户 | 真实模型会把上下文里的 `(ID: proj-default)`、`rev 1` 直接抄进回复（本轮截图已见） | 取舍：不改数据结构，只加提示，避免破坏既有上下文预算测试 | 行数 +1，已同步预算/裁剪测试断言 |
| `scripts/verify-host-iso.mjs` | 新增 `local` 模式（desktop 本机实例免令牌）；新增 3 项业务用例（自动建卡派发、成果严格一次回流且诚实、重复复用/疑问不误建卡）；断言改用本轮唯一时间戳，避免历史数据干扰；client.js 名册检查在 local 模式下跳过 | 让同一脚本既能验隔离 profile 也能验真实 desktop 实例 | — | 仅测试基础设施 |
| `tests/*` | 新增 `client_panel_contract.test.mjs`（main+图标成对注册、点击走 selectPanel、缺服务不抛错、状态/优先级文案）；`work_control_e2e.test.mjs` 新增用例 15/16（回流严格一次与诚实失败、自动建卡/复用/不误建卡）并把测试默认工作区根指向临时目录（`DSH_WORKBENCH_DEFAULT_ROOT`），避免回归测试写入用户真实工作区；`scheduler_context.test.mjs` 增加表达约束断言 | 把“桌面能点开”“成果会回流”“不会乱建卡”变成可回归的不变量 | — | 测试数 85 → 90 |

- 实际完成：上述六项源码/测试改动；desktop profile 升级到最终包；真实桌面面板可用、13 项端到端 PASS。
- 尚未实现：拖卡/停止/解除待核对等桌面交互未逐项人工点验（脚本只覆盖 API 层）；`sessionController` 真实服务名仍未探明；Mac 跨设备仍无。
- 与既定目标或接口有无差异：无新增 HTTP 路由；chat/send 响应新增/复用了 `task`、`intent`、`runs` 字段（此前该分支已返回这些字段，未破坏契约）。
- 新增依赖、运行成本和维护影响：无新依赖。自动建卡分支每命中一次会多一次真实 Worker 执行（真实模型成本），已通过保守判定和卡复用抑制。
- 数据 schema或公开接口变化及迁移/兼容：无 schema 变更；无迁移。
- 外部模型/宿主服务的具体依赖，是否可选：后台执行仍依赖 WorkBuddy 桥接（可选）；桥接不可用时按既有降级路径诚实失败。

## 4. 验证记录

| case/用户故事 | 候选版本/包哈希 | 环境及真实证据层 | 操作/命令与退出码 | 预期与实测 | 结果 | 脱敏证据路径 |
| --- | --- | --- | --- | --- | --- | --- |
| 全量回归 | `E0EF98E9...` 包对应源码 | UNIT/MOCK（Node test） | `npm test` 退出 0 | 期望 0 失败；实测 90 项 / 89 过 / 1 跳过 / 0 失败 | PASS | 命令输出 |
| 类型与构建 | 同上 | STATIC | `npm run typecheck`、`npm run build` 退出 0 | 无 TS 错误；client.js ModuleLoader 打包成功 | PASS | `lib/client.js` SHA `7BB29ADE...` |
| 面板契约 | 同上 | UNIT（执行打包产物 `lib/client.js`） | `node --test tests/client_panel_contract.test.mjs` | main 与 sidebar.panellist 成对注册、点击 selectPanel、缺服务不抛错、文案中文 | PASS | `tests/client_panel_contract.test.mjs` |
| 成果回流严格一次且诚实 | `E0EF98E9...` | MODEL+HOST：真实 desktop 实例（DSH desktop 0.2.1-rc.2，Electron 44.7.0） | `node scripts/verify-host-iso.mjs 56475 local evidence/host-desktop-20261024-r2.json` | 后台 Run 收敛后主对话恰有 1 条回流，含交付物路径与卡片状态；blocked 时不得声称完成 | PASS | [host-desktop-20261024-r2.json](../evidence/host-desktop-20261024-r2.json) |
| 一句工作指令自动开工 | 同上 | MODEL+HOST 真实 desktop | 同上（用例 12） | 建卡 + 派发 runs>0 + 落在既有项目 | PASS | 同上 |
| 重复复用 / 疑问不误建卡 | 同上 | MODEL+HOST 真实 desktop | 同上（用例 14） | 重复请求复用同卡，任务总数不变；疑问句不建卡 | PASS | 同上 |
| 真实桌面可视验收 | 同上 | DESKTOP（CDP 连真机渲染进程） | 重启应用 → 点侧栏“任务台”→ 截图 + 读取 console | 面板铺满、控制条/项目/卡片/主对话齐全；console error 0 条；状态与优先级均为中文，无内部 ID | PASS | [desktop-panel-20261024.png](../evidence/desktop-panel-20261024.png) |
| 真实模型表达约束 | 同上 | MODEL（真实桌面内的默认模型） | `POST /api/workbench/chat/send` “现在工作台整体状态怎么样？” | 回复为业务语义、无 `(ID: …)`/`rev N` | PASS | 本轮对话记录（未入库） |
| 隔离 profile 复验 | 旧包 `c2d70225...` | HOST（隔离 profile） | 本轮未重启隔离宿主（其数据目录被 desktop 端口占用检查命中后停止） | — | NOT_RUN | — |
| 拖卡/停止/解除待核对桌面点验 | 同上 | DESKTOP 人工交互 | 未执行 | — | NOT_RUN | — |
| Mac 真实跨设备 | — | REMOTE | 无 Mac | — | BLOCKED | — |

- 实际运行命令、工作目录、时间：均在 `<LOCAL_PATH>`；2026-10-24 15:40–16:45。
- 替身/模拟服务：单元回归中的 `apply(mockCtx)`、内存 DB；真实步骤为 desktop 实例上的真实宿主 + 真实模型 + 真实 SQLite。
- 关键负例/竞态/故障：① 登录式 `dsh plugin add` 在 desktop profile 失败（见 §5），改用目录安装并以哈希核对；② 首版回流消息把 blocked 卡写成“✅ 已完成”，被真实桌面证据发现并修正为“执行结束但未达验收”，同时加断言；③ `desktop` 端口每次重启变化，需按 `capabilities` 探测定位。
- 失败后修复了什么、重验了什么：修正回流标题语义 → 重新构建/打包/部署 → 13 项 PASS 复验。
- 未执行项已标 NOT_RUN/BLOCKED，未计入通过。

## 5. 版本与部署
- 修改后关键文件 SHA-256：`src/index.ts 56CEEC4C...`、`src/client.tsx F4049021...`、`src/host/services/domain.ts 6B5F6023...`、`src/host/services/context.ts 7946EC8E...`、`lib/client.js 7BB29ADE...`、`lib/index.js 21CCF4C7...`
- 包名、版本、SHA-256：`dsh-table@0.1.0`，`.artifacts/dsh-table-0.1.0.tgz` = `E0EF98E92B4E263BDD8095CB15CED51BC190C4BE01439DDD32D81171DA469484`
- 实际安装目标/profile/模式：`~/.dsh/profiles/desktop`（日常实例，bundle 列表已含 `dsh-table`），数据目录 `~/.dsh/workbench`
- 安装文件与候选包是否一致：一致——安装后 `lib/client.js`、`lib/host/services/context.js` 与本地构建逐文件 SHA-256 相同；运行时加载版本通过真实重启后面板/回流行为变化确认
- 活跃任务处理、备份、回滚是否实际验证：升级前 `~/.dsh/workbench/workbench.db` 无 running/unknown 执行、无 queued；备份目录 `~/.dsh/backups/dsh-table-desktop-20261024-1610`（含 `package.json`、`cordis.yml`、`cordis.patch.yml`、`pnpm-lock.yaml`、旧版 `dsh-table-installed/` 全量副本、`installed-lib-manifest.txt`、`VACUUM INTO` 的 `workbench.db`）。回滚=把 `dsh-table-installed/` 覆盖回 `profiles/desktop/node_modules/dsh-table` 并恢复被改的 `package.json` 依赖行；未演练回滚
- **部署方式偏差（必须知悉）**：desktop profile 的 `plugin add <tarball>` 失败——`package.json` 里 `dsh-table` 依赖写的是版本号 `0.1.0`，pnpm 去 registry 解析同名包失败。本轮把该依赖行改为 `file:C:/…/.artifacts/dsh-table-0.1.0.tgz` 后仍走不通 CLI 安装，最终采用 **解包 tarball 覆盖 `node_modules/dsh-table`** 的等价部署，并以哈希一致性 + 真实加载行为双重核对。该配置行是唯一被改动的 desktop profile 文件（备份可还原）
- 未部署就写 NOT_RUN：隔离 profile 未复验（NOT_RUN）；Mac 未部署（BLOCKED）
- 公开记录不含凭据或私人业务内容：证据文件与本文均未含令牌；`/connect` 令牌只出现在一次性本地命令中，未落盘

## 6. 开放问题与下一位的具体动作

| 优先级 | 问题ID | 事实与来源 | 下一步动作 | 完成时必须看到的证据 | 依赖/阻塞 |
| --- | --- | --- | --- | --- | --- |
| 高 | T-015 | desktop profile 的 `plugin add <tgz>` 失败：`package.json` 依赖被写成版本号而非文件源，CLI 因此走 registry | 用 `dsh plugin --profile desktop add <abs tgz path>` 前先确认依赖行为 `file:`（本轮已改），重新试一次 CLI 安装；成功后把 `node_modules/dsh-table` 目录改用 CLI 结果，避免手工覆盖 | CLI 退出 0 + 安装后 `lib/client.js` 哈希等于候选包内文件 + 重启后面板可用 | 无 |
| 高 | T-006/T-003 | 桌面交互（拖卡引用、单卡停止、解除待核对、刷新数据、停止全部工作）只在 API 层验证 | 在真实桌面逐项点验；`validation/scenarios.json` 已有对应用例 | 每项一张截图/一次状态变化记录 | 需真实桌面 |
| 中 | T-016 | 桌面工作台 DB 因本轮验证新增若干真实卡（“真实宿主验证卡”“整理一份真实宿主回归要点清单…”），属目标产品自身数据，未清理 | 决定是否保留为演示数据；若清理，需在应用中按卡删除并确认不回滚他人卡 | 任务板只余用户自有卡，或明确保留说明 | 需用户决定 |
| 中 | T-001/T-004 | `sessionController` 真实服务尚未接入，主助理交接靠自管状态 | 用宿主 `dump-config` 探明 agent/session 服务行名后接入 | `assistant_state` 里出现真实上一会话 id | 无 |
| 低 | T-007 | remoteconnect 桌面缺陷已由该项目修复（本轮实测宿主可启动） | 按其公开契约做双端联调（主入口→Mac 界面） | 两端版本协商与一次真实消息往返 | 需 Mac |

- 下一位第一条可执行动作：`npm test`（应 90 项 / 89 过 / 1 跳过 / 0 失败）+ `npm run build`；然后找到 desktop 实例端口（`Get-NetTCPConnection` 过滤 `DeepSeek Harness` 进程 + 试 `/api/workbench/capabilities`）并跑 `node scripts/verify-host-iso.mjs <port> local evidence/<新文件>.json`，应 13/13 PASS。
- 可并行推进的独立事项：T-015（CLI 安装路径正规化）、T-001/T-004（sessionController 探查）、桌面交互点验。
- 需要用户参与吗：暂不需要。若要清理本轮在桌面工作台生成的验证卡，需用户确认（T-016）。
- 新发现但不属于本轮范围的事项：宿主 asar 中的 panellist 契约（图标与 main 必须同 id 成对注册）建议补进 `docs/ARCHITECTURE.md`，避免后续再犯。

## 7. 交接自查
- [x] 已独立审核上一轮，说明证据和不同意见（更正“desktop 被阻塞”已过期）。
- [x] 已记录实际变更、设计理由和未完成部分。
- [x] 03-STATE已更新，04-LOG已追加，相关旧状态已校正。
- [x] 证据绑定当前版本；模拟、模型、宿主、桌面和跨设备分开。
- [x] 保留他人改动；释放本轮自有占用；未擅自提交或发布。
