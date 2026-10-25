项目：dsh-table

# 20261025-0445-external-review-audit：外部审查（Gemini 4 Argon）逐条审计 + 成立项加固 + 真机复验再发现

## 1. 身份与输入
- projectId / 实际绝对根目录：dsh-table / `<LOCAL_PATH>`（GitHub 镜像 richli-fugui/dsh-weave）
- roundId / 开始与结束时间：20261025-0445-external-review-audit / 2026-10-25 04:45 → 05:05（Asia/Shanghai）
- Agent或工具 / 模型：ZCode（GLM-5.3-Flash）
- 上一轮记录路径：[20261025-0420-audit-and-ui-labels.md](20261025-0420-audit-and-ui-labels.md)
- 输入版本：0.1.1 工作树（desktop 运行 github:richli-fugui/dsh-weave#c6f3671）；外加用户转达的外部审查报告（Gemini 4 Argon 对 GitHub main 的 review）
- 当前占用 owner / 允许写入范围：zcode-glm-20261025 / src/ tests/ scripts/ docs/ handoff/ evidence/ validation/
- 本轮目标：对 Gemini 审查逐条对照真实代码审计（成立才修，不照单全收）；修成立项；真机复验

## 2. 对外部审查（Gemini）的逐条审计
背景：用户把项目推到 GitHub（dsh-weave）并让 Gemini 审查。逐条对照本地真实代码：

| Gemini 主张 | 对照动作与证据 | 结论 | 处置 |
| --- | --- | --- | --- |
| 技术栈"基于 better-sqlite3、kysely 构建" | package.json：仅 react/typescript 等 devDeps，DB 用 node:sqlite（DatabaseSync） | **不成立（幻觉）** | 记录存档 |
| P0：unknown 状态死锁（updateTask 抛/stopRun conflict 且"无解除路径"） | T-012 已闭环：`reconcileUnknownRun/Queue`（domain.ts L376/L460）+ 调度器自动对账 + UI"核验/解除待核对"按钮 + 5 项专项测试；updateTask 的 UNKNOWN_OUTCOME 守卫是有意防绕过（只拦 blocked→todo 的手工改卡） | **不成立**（解除路径齐全且有测试） | 不改 |
| P0：createProject/createTask 缺事务 | 逐行核对：两方法 INSERT 后 appendOutboxEvent 无事务包裹（updateTask/updateProject/startRun/completeRun 等其余写均已 runTransaction） | **成立**（范围仅此两处） | 已修：+runTransaction |
| P0：UPDATE 缺 `AND revision = ?` | 逐行核对：updateTask/updateProject 的 SQL 仅 `WHERE id=?`；TS 层校验同步执行拦得住单进程，但 WAL 多进程（宿主+脚本并发）确有跨进程竞态窗口 | **成立**（防御性加固） | 已修：SQL 带版本条件 + changes===1 校验 + 冲突时抛 ConflictError |
| P1：executeRunAsync 无 .catch | 方法体整体 try/catch/finally 已兜底；残余风险仅善后路径自身抛错 | **部分成立**（防御性） | 已修：调用点追加 .catch 兜底（幂等清理） |
| P1：drainQueue"先清内存再写库导致失步" | 逐行核对：逐项 try/catch + unconsumed 回滚重挂内存，注释明示设计意图 | **基本不成立** | 不改 |
| P1：host-session"轮询缺超时" | sendAndCollect 自带 replyTimeoutMs（默认 180s）+ 轮询间隔 | **不成立**（超时存在）；外部 AbortSignal 确无（当前无真实调用方需要，HTTP 客户端断开由 180s 上界兜底） | 不改（避免投机 API）；记录待有真实需求再接 |
| P1：缺 busy_timeout | database.ts 仅有 WAL+foreign_keys；多进程（宿主+部署/验证脚本）确实并发触同一 DB | **成立** | 已修：`PRAGMA busy_timeout = 5000` |
| P2：ai-client 正则脆弱+静默 catch | 正则宽松是有意为之（凭据文件把键存于缩进行/JSON payload 内，严格 YAML 解析取不到——2026-10-24 实证）；静默 catch 属实 | **部分成立** | 已修：保留宽松正则（加注释防收紧）+ 三处 console.warn 留痕 |
| P2：getTask JSON.parse 无容错 | 5 处裸 parse（dependencies×3、outcome×2） | **成立** | 已修：safeParseJsonArray/Object 降级 |
| P2：index.ts 停止未清理 | 0420 轮已加 ctx.on('dispose')（db.close + tracker 停止） | **已过时**（已修） | 不改 |
| P2：remote.ts 心跳退避、client ErrorBoundary | remote 已有代次守卫+UNKNOWN_OUTCOME（T-011），SSE 心跳属增强；ErrorBoundary 确无 | **部分成立** | ErrorBoundary 已加（见 §3）；心跳退避记录为低优先增强，本轮不做 |
| T-017/T-001 待办清单 | T-017 已在 0330 轮 5/5 闭环 | **已过时** | 不改 |
| verify-host-continuity 改 raw 模式 | 0330 轮已改为 raw user input 模式（03-STATE 记载 3 轮真实探针 PASS） | **已过时** | 不改 |

审计总结：14 项主张中 4 项完全成立（已修）、3 项部分成立（防御性/部分已修）、5 项不成立或幻觉（better-sqlite3/kysely、unknown 死锁、drainQueue、超时缺失、以及若干"已过时"——Gemini 疑似读了旧文档而非当前代码）。

## 3. 本轮实现与理由
| 文件 | 改了什么 | 为什么 | 影响与回滚 |
| --- | --- | --- | --- |
| src/host/services/domain.ts | ① createProject/createTask 包 runTransaction；② updateTask/updateProject 的 UPDATE 加 `AND revision = ?` + changes!==1 → ConflictError（重读最新版）；③ safeParseJsonArray/Object 替换 5 处裸 JSON.parse | Gemini 审计成立项 | 单文件回滚；无 schema/接口变更 |
| src/host/db/database.ts | `PRAGMA busy_timeout = 5000` | 多进程并发写等待而非 SQLITE_BUSY | 无 |
| src/host/services/scheduler.ts | executeRunAsync 调用点追加 .catch 兜底（幂等清理：尽力标 failed→删槽位→resolveStop→drainQueue） | 残余 Unhandled Rejection 防线 | 无 |
| src/client.tsx | 新增导出 `PanelErrorBoundary`（getDerivedStateFromError + 中文错误卡 + 重试按钮）并包裹面板主内容 | 面板渲染异常不再炸宿主整个 Web 壳 | 无 |
| scripts/bundle-client.mjs | 导出转换补 `export class` 分支；导出挂载改为收集式（修复上轮"通用转换器"漏 class 的缺口——本轮 ErrorBoundary 暴露） | 产物曾残留 `export class` 语法 | 重建即生效 |
| src/index.ts | **optionalService 回归修复**：reflect 优先；属性直取必须独立 try 包裹（代理抛错→undefined；mock 直挂属性可取）。此前 T-017 轮引入的直落回退在真实 cordis 下抛 "cannot get property agentRunner without inject"，炸掉 worker 整链（本轮 iso 真机复现） | 真机复现的 P0 级回归 | 单函数回滚 |
| src/host/services/ai-client.ts | 凭据读取三处 console.warn 留痕；宽松正则加注释禁收紧 | 静默失败不可诊断 | 无 |
| tests/durability_hardening.test.mjs（新增 10 用例） | busy_timeout/事务回滚（实体+无孤儿事件）/SQL 乐观锁（Task+Project，模拟跨进程写者）/脏 JSON 降级/ErrorBoundary 真实产物语义/调度器兜底契约/cordis 代理式 ctx 优雅降级 | 把成立项变成永久回归 | — |
| tests/execution_safety.test.mjs | 客户端加载桩补 Component 基类（产物合法 React 用法）+ 边界导出断言 | 新产物导出类后旧桩失效 | — |

## 4. 验证记录
| case | 版本 | 层 | 命令与退出码 | 结果 | 证据 |
| --- | --- | --- | --- | --- | --- |
| 全量回归 | bfc67ef6... | UNIT | `npm test` | 121 项 120 过 1 跳过 0 失败 | 命令输出 |
| 加固专项 | 同上 | UNIT | `node --test tests/durability_hardening.test.mjs` | 10/10 PASS | 同上 |
| typecheck/build | 同上 | STATIC | 退出 0；产物 0 残留 export | PASS | 命令输出 |
| **真机复验（第一轮，暴露回归）** | 56d922e7... | HOST | iso 宿主 boot + verify 14 项 | 14/14 PASS 但 worker 回流含 `cannot get property "agentRunner" without inject`（T-017 轮 optionalService 直落回退在真机 cordis 下崩溃）→ 定位修复 | [host-iso-20261025-hardening.json](../../evidence/host-iso-20261025-hardening.json) |
| **真机复验（最终版）** | bfc67ef6... | HOST | iso 宿主重启 + verify | 14/14 PASS；回流无 inject 崩溃；worker 在桥接密钥缺失下诚实 blocked | [host-iso-20261025-hardening-r2.json](../../evidence/host-iso-20261025-hardening-r2.json) |
| desktop 实例 | github c6f3671（未含本轮改动） | HOST | 未部署（desktop 走 GitHub 固定提交来源，push 需用户授权） | NOT_RUN（如实标注） | — |

## 5. 版本与部署
- 关键哈希（前16位）：index.ts `41310c28`、domain.ts `5615c0cf`、database.ts `9a795365`、scheduler.ts `2a620e5e`、client.tsx `66c0b856`、ai-client.ts `dd11c7f1`、durability_hardening.test.mjs `87b5718a`、bundle-client.mjs `de62245c`
- 包：`dsh-table@0.1.1` tarball `bfc67ef6a04e1b3bc295b60add25877f220d59cbf7c2674bca395288b1b506d1`
- 安装：仅隔离 profile（iso CLI 安装失败——先删旧 tarball 致依赖行悬空+pnpm 空诊断报错，改等价解包安装，双端 lib/index.js 哈希 `5d56ee0a` 一致）；**desktop 未动**（运行 github 固定提交，本轮改动待用户下次 push 后升级）
- Git：全部改动留在工作树未提交（遵循不擅自 commit/push 规则）

## 6. 环境发现（重要）
1. **`~/.dsh/.credentials.yaml` 已不再包含 WORKBUDDY_BRIDGE_API_KEY 行**（文件被重写；桥接服务本身仍在 8787 且要鉴权）。影响：desktop 与 iso 的 worker 桥接直连路径将诚实不可用（新加的 warn 会留痕）；宿主会话路径（openai-codex/gpt-6-luna）不受影响。可能需要用户重新配置 WorkBuddy 桥接密钥（WorkBuddy 侧更新所致）。
2. iso profile 的 `dsh plugin add` 在旧 tarball 被删后依赖行悬空时报空诊断错误——部署纪律：删旧 tarball 前先更新依赖行。

## 7. 开放问题与下一位动作
| 优先级 | ID | 事实 | 下一步 |
| --- | --- | --- | --- |
| 高 | 发布 | 本轮加固+回归修复在工作树，desktop 运行旧 github 提交 | 用户决定何时 commit+push；升级 desktop 后跑一次 14 项复验 |
| 高 | 环境凭据 | 桥接密钥行消失，worker 桥接路径不可用 | 用户在 WorkBuddy/凭据侧恢复密钥；或确认全面转向宿主会话路径（T-002） |
| 中 | T-002 | attachWorkerSession 通道已就绪 | Worker 接宿主独立项目根 Session（03-STATE 既有计划） |
| 低 | remote 心跳退避 | Gemini 建议项，代次守卫已覆盖主要风险 | 有真实断连场景再做 |

- 下一位第一条动作：`npm test`（应 121/120/1/0）确认基线；然后按 03-STATE 的 T-002 主线推进（Worker 宿主会话化），注意 §6 环境凭据变化对桥接路径的影响。
- 需要用户参与：① 何时把本轮改动 push 到 dsh-weave 并升级 desktop；② WorkBuddy 桥接密钥是否恢复（否则 worker 办公任务在宿主会话化完成前会诚实 blocked）。

## 8. 交接自查
- [x] 独立审核（外部审查逐条 + 上轮代码），证伪处给出证据
- [x] 实际变更、理由、未完成部分已记录
- [x] 03-STATE/04-LOG 已更新；占用锁已释放
- [x] 证据分层（UNIT 全绿 / HOST 14/14 / DESKTOP NOT_RUN 如实）
- [x] 保留他人改动；未擅自 commit/push
