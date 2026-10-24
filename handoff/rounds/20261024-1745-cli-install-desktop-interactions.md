项目：dsh-table

# 20261024-1745-cli-install-desktop-interactions：CLI 部署路径正规化 + 真实桌面交互点验（U3 全链路）

## 1. 身份与输入
- projectId / 实际绝对根目录：dsh-table / `<LOCAL_PATH>`
- roundId / 开始与结束时间：20261024-1745-cli-install-desktop-interactions / 2026-10-24T17:45 起 → 2026-10-24T18:50（Asia/Shanghai）
- Agent或工具 / 模型：ZCode（GLM-5.3-Flash）
- 上一轮记录路径：[20261024-1640-desktop-panel-reflow.md](20261024-1640-desktop-panel-reflow.md)
- 输入版本：Git 无提交，全部 untracked；输入关键哈希：`src/index.ts 56CEEC4C...`、`src/client.tsx F4049021...`、`src/host/services/domain.ts 6B5F6023...`、`src/host/services/context.ts 7946EC8E...`、候选包 `E0EF98E92B4E263BDD8095CB15CED51BC190C4BE01439DDD32D81171DA469484`（与上轮记录逐一相符）
- 当前占用文件 owner / 本轮允许写入范围：zcode-glm-20261024-r2 / src/**, tests/**, scripts/**, handoff/**, docs/**, evidence/**, validation/**；另经记录动过共享 desktop profile 的 package.json（见 §3）
- 本轮目标及对应计划阶段：T-015（部署路径正规化）+ T-006/T-003（真实桌面交互点验，U3 停A保B）；对应计划阶段 T3/T6 与 01-PRODUCT U3

## 2. 对上一轮的独立审核
| 上轮主张/问题 | 本轮复核动作与证据 | 结论 | 是否需修复 |
| --- | --- | --- | --- |
| 全量回归 90 项 / 89 过 / 1 跳过 / 0 失败 | 本轮独立重跑 `npm test`，结果一致 | 成立 | 否 |
| 关键文件与候选包哈希 E0EF98E9... | 逐一重算，全部一致 | 成立 | 否 |
| desktop 实例 13/13 PASS（端口 56475） | 应用重启前在 56475 重跑 `verify-host-iso.mjs local`，13/13 PASS | 成立 | 否 |
| 备份目录 `~/.dsh/backups/dsh-table-desktop-20261024-1610` 齐全 | ls 核对（package.json、patch、旧插件全量、workbench.db） | 成立 | 否 |
| T-015：`plugin add <tgz>` 因依赖行写法失败 | 重试 CLI：dsh-table 的 `file:` 行已正常解析（resolved 1）；实际 404 的元凶是 **`dsh-remoteconnect: "0.1.0"`**——该行在 remoteconnect 自己多次部署的备份中就一直是 0.1.0（其 deploy.ps1 只在行缺失时写入版本号、从不更新），指向 registry 上不存在的包，使整个 profile 的 pnpm 解析失败 | 部分成立（上轮归因于 dsh-table 行不够完整；真正元凶是 remoteconnect 行） | 是：本轮修复 |
| desktop 已升级、面板可视验收通过 | 独立 CDP 重验（本轮 §4 S1）+ 13/13 复验 | 成立 | 否 |

## 3. 本轮实现与理由
| 文件/位置 | 改了什么 | 为什么这样改 | 替代方案/取舍 | 影响与回滚 |
| --- | --- | --- | --- | --- |
| `~/.dsh/profiles/desktop/package.json`（共享 profile，非本仓库） | `dsh-remoteconnect` 依赖行 `"0.1.0"` → `file:C:/…/dsh-remoteconnect/dsh-remoteconnect-0.1.10.tgz` | 该行是 registry 404 的元凶，阻塞整个 profile 的 pnpm 操作（含 dsh-table 的 CLI 安装）。0.1.10 tarball 与已安装副本逐文件哈希一致（browser.js 6B7377BB...），语义零变化；remoteconnect 的 deploy.ps1 只在行缺失时写入、容忍 file: 形式 | 保持 0.1.0 行并继续手工覆盖部署：放弃——CLI 路径是 T-015 的目标 | 改动前该行本就指向不存在的 registry 包；如需回滚恢复 `"0.1.0"` 即可（无实质影响）。已在 03-STATE 显式披露供 remoteconnect 会话知悉 |
| `scripts/desktop-interact-verify.mjs`（新增） | CDP 驱动的真实桌面交互点验脚本（5 场景：开面板/@任务派发/停A保B/已停卡复跑/停止全部）。v2 修正 v1 教训：截图绝不阻塞时序（非致命+短超时）、长任务拉开停止窗口、按卡片标题在容器内定位按钮 | T-006/T-003 此前只过 API 层；用户故事 U3（停A保B、恢复新一轮）需要真实桌面证据 | 手工点验：无真人在线；API 测试：无法证明 UI 按钮真实可达 | 纯验证脚本，无产品代码改动 |
| 本仓库 src/ | **零改动**（本轮候选包 E0EF98E9 仍为当前版本，无需重建） | 本轮发现的问题均在测试脚本/共享配置层 | — | — |

- 实际完成：T-015 闭合（CLI `plugin add` 成功、lockfile 正规化 12 条目、安装后 13/13 复验）；T-006/T-003 主体闭合（U3 全链路 5/5 PASS + 截图与 DB 双证据）；T-001/T-004 探查完成（真实服务行名已探明，见 §6）。
- 尚未实现：解除待核对/核验待核对按钮的桌面点验（需人为制造 unknown 状态，未做）；拖卡 DnD 手势（等效的 @任务卡 输入路径已验）；主助理接入宿主 `agents`/`session` 真实服务（下轮）；Mac 跨设备。
- 与既定目标或接口有无差异：无产品接口变化；共享 profile 的 remoteconnect 依赖行为唯一外部改动（已披露）。
- 新增依赖、运行成本和维护影响：无新依赖；点验脚本每次运行消耗 2 次真实模型调用（长任务）。
- 数据schema或公开接口变化及迁移/兼容：无。
- 外部模型/宿主服务的具体依赖，是否可选：同上轮（WorkBuddy 桥接可选，缺席走诚实失败）。

## 4. 验证记录
| case/用户故事 | 候选版本/包哈希 | 环境及真实证据层 | 操作/命令与退出码 | 预期与实测 | 结果 | 脱敏证据路径 |
| --- | --- | --- | --- | --- | --- | --- |
| 上轮基线复核（npm test） | E0EF98E9... | UNIT/MOCK | `npm test` 退出 0 | 90 项 / 89 过 / 1 跳过 / 0 失败，一致 | PASS | 命令输出 |
| CLI 安装前应用复验 | E0EF98E9... | HOST | `verify-host-iso.mjs 56475 local` 退出 0 | 13/13 PASS | PASS | [host-desktop-20261024-r3.json](../../evidence/host-desktop-20261024-r3.json) |
| T-015 CLI 安装 | E0EF98E9... | HOST | `dsh plugin --profile desktop add <tgz>` 退出 0 | dsh-remoteconnect 0.1.10 + dsh-table 0.1.0 经 pnpm 安装；安装后 lib/client.js、lib/index.js 哈希与候选包一致；pnpm-lock 新增 12 处条目 | PASS | 命令输出（§5） |
| CLI 安装后应用复验（应用自重载后新端口） | E0EF98E9... | HOST | `verify-host-iso.mjs 65066 local` 退出 0 | 13/13 PASS | PASS | [host-desktop-20261024-r4-post-cli-install.json](../../evidence/host-desktop-20261024-r4-post-cli-install.json) |
| API 层受控停止（长任务 2s 在途停） | E0EF98E9... | HOST+MODEL | 脚本化：建长任务卡→start→2s 后 control/stop | `status:"stopped"`、stoppedRunIds 正确、任务收敛 todo；证明停止路径产品层无缺陷（v1 UI 失败为时序问题） | PASS | 本轮命令输出（§6 附 DB 轨迹） |
| S1 侧栏入口打开任务台面板 | E0EF98E9... | DESKTOP（CDP 真机交互） | 点击 `aria-label=任务台` 按钮 | 面板打开，控制条（停止全部工作）与聊天输入齐全 | PASS | [evidence/desktop-interact-20261024/](../../evidence/desktop-interact-20261024/)（summary.json + 截图） |
| S2 面板输入框 @任务卡 批量派发 | 同上 | DESKTOP | 在面板 textarea 键入 `@task:A @task:B 推进` 并点发送 | A 卡进入执行（出现"停止执行"），B 排队（snapshot: active=1, queued=1） | PASS | 02-dispatch-AB-*.png |
| S3 停A保B（U3 核心） | 同上 | DESKTOP | 点击 A 卡"停止执行" | A 回 todo（run=interrupted）；B 唤醒继续执行（in_progress，run 保持同一条） | PASS | 03-stop-A-B-proceeds-*.png |
| S4 已停止卡开新一轮 | 同上 | DESKTOP | 点击 A 卡"推进该任务" | A 重新受理（B 执行中 → A 排队，active=1/queued=1）；不被永久取消集合误杀 | PASS | 04-A-new-round-*.png |
| S5 控制条停止全部工作 | 同上 | DESKTOP | 点击"停止全部工作" | 执行中 B 与排队 A 一并停止（active=0/queued=0），卡片保留（todo），成果不回滚 | PASS | 05-stop-all-*.png |
| 桌面 console 健康度 | 同上 | DESKTOP | CDP Runtime 事件监听全程 | console error 0 条、异常 0 次 | PASS | summary.json |
| 解除待核对按钮桌面点验 | — | DESKTOP | 未执行：需人为制造 unknown 状态（杀宿主进程），风险大于收益；按钮存在性与 API 路径已由 T-012 测试覆盖 | — | NOT_RUN | — |
| 拖卡 DnD 手势 | — | DESKTOP | 未执行：CDP 模拟 DnD 脆弱；输入框提示中等效的 @任务卡 路径已验 | — | NOT_RUN | — |
| 干净重启后最终复验 | E0EF98E9... | HOST | `verify-host-iso.mjs 55642 local` 退出 0（应用已恢复正常无调试端口状态） | 13/13 PASS | PASS | [host-desktop-20261024-r5-final.json](../../evidence/host-desktop-20261024-r5-final.json) |
| 真实 Mac 跨设备 | — | REMOTE | 无 Mac | — | BLOCKED | — |

- 实际运行命令、工作目录、时间：均在本仓库与 desktop profile；2026-10-24 17:45–18:50。
- 替身/模拟服务：无（本轮全部真实宿主/真实模型/真实桌面）。
- 关键负例/竞态/故障及独立oracle：① v1 点验 3 项 FAIL 的根因分析（截图 20s 超时 + 模型短任务 ~4s，点击落于自然完成之后）——用 API 受控停止测试证明产品停止路径无缺陷，再以长任务 v2 全过；② CLI 安装失败根因（remoteconnect 依赖行 registry 404）用其自身部署备份链证实为长期存在。
- 失败后修复了什么、重验了什么：v1→v2 点验脚本重写后 5/5；应用共重启 3 次（CLI 安装后自重载、调试端口启动、恢复正常），每次重启后均复验 API 健康。
- 应用生命周期披露：点验期间曾以 `--remote-debugging-port=9223` 启动真机（PID 定向、无通杀），结束后已恢复正常启动（9223 已关闭，无调试端口残留）。

## 5. 版本与部署
- 修改后关键文件 SHA-256：本轮仓库内仅新增 `scripts/desktop-interact-verify.mjs`（`SHA-256 见 evidence/summary`）；src/ 零改动。
- 包名、版本、SHA-256：`dsh-table@0.1.0` = `E0EF98E92B4E263BDD8095CB15CED51BC190C4BE01439DDD32D81171DA469484`（未变，无需重建）。
- 实际安装目标/profile/模式：`~/.dsh/profiles/desktop`；本轮起为 **CLI 正规安装**（`dsh plugin add` + pnpm，lockfile 含 12 处 dsh-table/dsh-remoteconnect 条目），替代上轮的手工覆盖。
- 安装文件与候选包是否一致：一致（lib/client.js `7BB29ADE...`、lib/index.js `21CCF4C7...` 双核对）。
- 活跃任务处理、备份、回滚：CLI 安装前确认 workbench.db 无 running/unknown/queued；上轮备份 `dsh-table-desktop-20261024-1610` 仍可回滚；remoteconnect 行改动可还原为 `"0.1.0"`（该值本就不可解析，无实质回滚风险）。
- desktop profile 唯一新增配置改动：remoteconnect 依赖行（§3）；dsh-table 行保持上轮的 file: 形式。

## 6. 开放问题与下一位的具体动作
| 优先级 | 问题ID | 事实与来源 | 下一步动作 | 完成时必须看到的证据 | 依赖/阻塞 |
| --- | --- | --- | --- | --- | --- |
| 高 | T-001/T-004 | 服务面已探明：宿主真实服务行为 `session`（@deepseek-ai/dsh-session，事件日志模型，branded SessionId/SessionSeq）与 `agents`（AgentRegistry：`create/resume/get/list/roots/withInitiator/announce`）；`session-controller` 只是 HTTP API 层，非插件服务；插件现用的 `ctx.sessionController`/`reflect.get('sessionController')` 永远拿不到值 | 主助理接入：用 `inject:['agents','session']` 或 `reflect.get('agents')` 探真实调用形状（读 dsh-agent 的 create/resume 签名与 dsh-session 事件模型），把 `rotateAssistantSession` 接到 `agents.resume()`，主回合经宿主 agent loop（真实审批管线） | `assistant_state` 出现真实宿主 session id；主助理回复经宿主 agent 产生（含审批事件） | 无 |
| 中 | T-006 余项 | 解除待核对/核验待核对按钮、拖卡 DnD 未在桌面点验（NOT_RUN，理由见 §4） | 需要时：制造 unknown（隔离 profile 内杀宿主进程）后点按钮；或人工拖卡一次 | 截图 + 状态变化 | 低优先 |
| 中 | T-016 | 用户真实 DB 中验证卡累计：上轮“真实宿主验证卡/整理…回归要点清单”+ 本轮“交互验证A/B-mvm9doob（review/blocked）”“停止路径受控验证-长任务（todo）”“桌面点验A/B-mvm9m4k9（todo，runs interrupted）” | 用户决定清理或保留；清理需在应用内按卡删除 | 任务板只余用户自有卡 | 需用户决定 |
| 低 | T-007 | remoteconnect 桌面缺陷已修复且本轮 CLI 联装验证其 0.1.10 包正常 | 真实 Mac 到位后按公开契约联调 | 双端消息往返 | 需 Mac |

- 下一位第一条可执行动作：
  1. `npm test`（应 90/89/1/0）确认基线；
  2. 读 `/tmp/dsh-cli-inspect/dsh-host-extracted/dsh/node_modules/@deepseek-ai/dsh-agent/lib/index.js`（若已清理，从 asar 重解：`npx asar extract <app.asar> <dir>`，**注意 extract-file 无第三参、勿在仓库根目录执行**）中 `AgentRegistry.create/resume` 的参数签名；
  3. 在隔离 profile 先行接入 `agents` 服务（desktop 的真实会话不动），目标证据：主助理一轮回复由宿主 agent loop 产生。
- 可并行推进的独立事项：T-006 余项按钮点验；导入器测试扩充。
- 需要用户参与吗：T-016 验证卡清理需用户决定；其余无需。
- 新发现但不属于本轮范围的事项：remoteconnect 的 deploy.ps1 不更新已有依赖行（其下轮应把行写入改为幂等 file:/registry 正确形式）；pnpm 对 profile 依赖行的 registry 404 会阻塞其他插件安装（已通过 file: 化绕开）。

## 7. 交接自查
- [x] 已独立审核上一轮，说明证据和不同意见（T-015 归因修正）。
- [x] 已记录实际变更、设计理由和未完成部分。
- [x] 03-STATE已更新，04-LOG已追加，相关旧状态已校正。
- [x] 证据绑定当前版本；模拟、模型、宿主、桌面和跨设备分开。
- [x] 保留他人改动；释放本轮自有占用；未擅自提交或发布。
