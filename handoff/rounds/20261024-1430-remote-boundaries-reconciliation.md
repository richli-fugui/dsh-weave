# 20261024-1430-remote-boundaries-reconciliation：远程边界安全修复与未决对账闭环

## 1. 身份与输入
- projectId / 实际绝对根目录：dsh-table / <LOCAL_PATH>
- roundId / 开始与结束时间：20261024-1430-remote-boundaries-reconciliation / 2026-10-24T14:27:44+08:00 至 2026-10-24T14:42:00+08:00（Asia/Shanghai）
- Agent或工具 / 模型：Antigravity
- 上一轮记录路径：[handoff/rounds/20261023-2133-execution-safety.md](20261023-2133-execution-safety.md)
- 输入版本：Git working tree dirty（无提交，全部 untracked）；输入包 SHA-256: DEB1558A717440416DE57FE853CD4042122F64165D2486B2C83E7A2B5317B831
- 当前占用文件owner / 本轮允许写入范围：antigravity-20261024 / src/providers/remote.ts, src/host/services/domain.ts, src/host/services/scheduler.ts, src/providers/local.ts, src/index.ts, src/client.tsx, tests/**, scripts/**, handoff/**, docs/**
- 本轮目标及对应计划阶段：T-011（解决已复现的 RemoteProvider 代次变化与身份一般错误兼容降级漏洞）、T-012（建立可验证未决状态 Host 查询、对账及界面解除机制，彻底消除手动改 SQLite 依赖）；对应计划阶段 T3 与 T5。

## 2. 对上一轮的独立审核
| 上轮主张/问题 | 本轮复核动作与证据 | 结论（成立/部分/不成立/未验证） | 是否需修复 |
| --- | --- | --- | --- |
| 73 项回归测试 72 过 1 跳过 | 重新运行 `npm test`，通过数与跳过数一致 | 成立 | 保留已有测试基线 |
| T-011 存在两项反例 FAIL（代次变更旧响应通过、身份一般故障降级放行） | 运行 `node scripts/audit-remote-boundaries.mjs`，复现退出码 1，两项用例确为 FAIL | 成立 | 必须在本轮立即修复 |
| 启动崩溃保守将未决 Run 设为 unknown 并锁定项目 | 检查 `domain.ts` 与 `scheduler.ts`，逻辑确已生效 | 成立 | 保留保守保护，但需补齐安全解除机制（T-012） |
| 未决状态无法自动对账，依赖手工改数据库 | 源码此前未提供任何 `reconcileUnknownRun` 或解除接口，改卡为 todo 也会被阻断 | 成立 | 必须在本轮实现自动对账与控制路径解除 |
| 真实模型套件通过 | 显式开启门禁 `$env:TEST_REAL_LLM="true"` 后运行 `host_ai_integration.test.mjs`，5 项子断言全绿通过 | 成立 | 继续保持门禁隔离，避免常规回归无意消耗 |

## 3. 本轮实现与理由
| 文件/模块 | 改了什么 | 为什么这样改 | 替代方案/取舍 | 影响与回滚 |
| --- | --- | --- | --- | --- |
| src/providers/remote.ts | 1. 增加 `generationCounter` 单调递增代次跟踪；在途请求代次变更时，读操作拒绝旧响应并抛出 `CANCELLED`，写操作抛出 `UNKNOWN_OUTCOME`。<br>2. 移除 `ensureNegotiated` 中吞掉 `DOMAIN_ERROR` 的漏洞，仅在对端明确未实现端点（`UNSUPPORTED_CAPABILITY`）时进入兼容模式，一般性后端身份故障硬阻断业务调用。<br>3. `rotateAssistantSession` 自动补充 `clientRequestId` 幂等透传；`followEvents` 增加旧代次事件丢弃守卫。 | 彻底闭合 T-011。迟到的旧代次读响应绝不可当作当前事实；身份端点遭遇一般故障时绝不可放行业务写操作，必须 fail-closed。 | 替代方案：仅在 adapter 层面处理。取舍：在 Provider 核心实现代次跟踪，具备纯客户端自愈与多适配器防御能力。 | 无破坏性改动。回滚只需还原 remote.ts。 |
| src/host/services/domain.ts | 1. 增加 `listUncertainRuns()`、`reconcileUnknownRun()` 与 `reconcileUnknownQueue()`，支持以 completed / interrupted / failed 原子对账并恢复任务状态。<br>2. `updateTask` 增加守卫：当卡片因未决执行 blocked 时，严禁试图手动直接改回 todo，强制走对账逻辑。 | 满足 T-012“不凭文件存在或用户改卡为 todo 解除”的铁律；提供原子、可追溯且产生 Outbox 事件的解除途径。 | 替代方案：允许强制改卡。取舍：坚守数据一致性，不给幽灵重放开后门。 | 保证事务与版本递增一致。 |
| src/host/services/scheduler.ts | 1. 扩展 `WorkerReconciler` 契约，支持自动向 Host 查询执行进程状态（running / completed / exited / not_found）。<br>2. 实现 `reconcileUncertainRuns()`：Host 报告 running 则保持保护；报告 exited/not_found 则自动对账为 interrupted 并触发 `drainQueue()` 唤醒排队项。<br>3. 提供 `reconcileRun` 与 `reconcileQueue` 调度集成。 | 调度器跨重启后可与 Host 联动自动对账，同时保留操作员显式解除接口。 | 替代方案：全靠定时轮询。取舍：显式查询与按需调用结合，避免空轮询风暴。 | 提高调度鲁棒性。 |
| src/providers/local.ts | 暴露 `listUncertain`、`reconcileRun`、`reconcileQueue` 与 `autoReconcileWithWorker`。 | 统一 Provider 接口，便于本地与 WebServer 路由直接消费。 | 无。 | 无副作用。 |
| src/index.ts | 1. `WorkbenchConfig` 增加 `workerReconciler` 注入支持。<br>2. 注册 `GET /api/workbench/control/uncertain` 与 `POST /api/workbench/control/reconcile` 路由。 | 将对账能力暴露至控制路径，支持自动检测与人工决策。 | 无。 | 路由增加，不影响原有 API。 |
| src/client.tsx | 1. 常驻控制条：当 `unknownCount > 0` 时展示“核验待核对”按钮，支持一键核验解除。<br>2. 任务卡：为 blocked 且处于 unknown 的卡片增加“解除待核对”操作按钮。 | 用户无需操作终端或数据库，直接在界面可感知、可核实、可一键解除保护。 | 无。 | 界面体验与状态反馈更友好。 |
| tests/remote_contract.test.mjs | 新增测试用例 10（T-011a in-flight 代次变更拒绝旧响应/未知写）与用例 11（T-011b 身份一般后端故障阻断业务写）。 | 将独立反例直接吸纳为标准回归用例，杜绝再次退化。 | 无。 | 永久回归保护。 |
| tests/reconciliation_t012.test.mjs | 新增 5 项专项用例：防改卡绕过、显式对账中断恢复、显式对账完成入库、Scheduler 与 Host 查询联动及 WebServer 端到端路由闭环。 | 建立对账机制全链路客观证据。 | 无。 | 永久回归保护。 |

- 实际完成：T-011 彻底关闭（反例脚本与单元测试 100% 通过）；T-012 彻底关闭（领域、调度、服务、界面与专项测试全链路接通）。
- 尚未实现：真实 Mac 物理机日用验收（A01/A16，当前环境为 Windows 11，无真实 Mac，如实标为 BLOCKED）。
- 与既定目标或接口有无差异：无差异，严格遵循 0.1-draft 契约与交接文档要求。
- 新增依赖、运行成本和维护影响：零新增 npm 依赖，原生 SQLite 事务持久化。
- 数据schema或公开接口变化及迁移/兼容：无 schema 变更，兼容当前版本。
- 外部模型/宿主服务的具体依赖，是否可选：常规测试完全本地化（含 HTTP 替身），真实模型集成测试通过 `TEST_REAL_LLM=true` 显式门禁保护。

## 4. 验证记录
| case/用户故事 | 候选版本/包哈希 | 环境及真实证据层 | 操作/命令与退出码 | 预期与实测 | PASS/FAIL/BLOCKED/NOT_RUN | 脱敏证据路径 |
| --- | --- | --- | --- | --- | --- | --- |
| 独立远程边界反例 | D606839741814AE2C7A443D889FDE5E09C8CFC68B28CD501EAF11D23183C8DE9 | UNIT/MOCK | `node scripts/audit-remote-boundaries.mjs`，退出码 0 | T-011a/b 预期均由 FAIL 转为 PASS；实测一致 | PASS | [evidence/remote-boundary-audit-20261023.json](../../evidence/remote-boundary-audit-20261023.json) |
| 契约符合性测试 | 同上 | UNIT/MOCK | `node --test tests/remote_contract.test.mjs`，退出码 0 | 12 项测试全部 PASS | PASS | 本地运行实时输出 |
| T-012 恢复与对账专项 | 同上 | UNIT/MOCK | `node --test tests/reconciliation_t012.test.mjs`，退出码 0 | 5 项专项断言全部 PASS | PASS | 本地运行实时输出 |
| 全量自动化回归 | 同上 | UNIT/MOCK | `node --test tests/*.test.mjs`，退出码 0 | 81 项测试：80 项 PASS，1 项门禁跳过，0 项 FAIL | PASS | 本地运行实时输出 |
| 真实在线 LLM 集成测试 | 同上 | MODEL (真实在线调用) | `$env:TEST_REAL_LLM="true"; node --test tests/host_ai_integration.test.mjs`，退出码 0 | 4 项正反例及连续多轮真实模型断言全部 PASS | PASS | 本地运行实时输出 |
| 解包与模块完整性冒烟 | 同上 | STATIC / UNIT | 解包 tarball 并执行动态导入导出校验，退出码 0 | 成功导出 18 个核心构件，无缺损 | PASS | 本地运行实时输出 |
| 真实 Mac 桌面验收 | N/A | REMOTE / DESKTOP | 物理 Mac 验收 | Windows 11 环境无 Mac 实机 | BLOCKED | 保持如实标注 |

- 实际运行命令、工作目录、时间和结果：见上表，所有测试均在 Windows 11 环境执行完毕并通过。
- 替身/模拟服务有哪些：常规测试采用测试 key 与本地 HTTP 替身；真实模型套件调用本地已授权的 WorkBuddy 8787 桥接。
- 关键负例/竞态/故障及独立oracle：代次变更抢占旧响应、一般后端错误防降级放行、禁止通过修改任务卡直接解除 unknown 保护、Worker 仍在运行时拒绝调度下游任务。
- 失败后修复了什么、重验了什么：修复了代次变化追踪漏洞与身份降级漏洞，重跑反例脚本已通过。

## 5. 版本与部署
- 修改后关键文件 SHA-256：
  - `src/providers/remote.ts`: `E97E029A8D948D939A84CD806B5A90869ACB18D4C374A522FA33AFEC9238901D`
  - `src/host/services/domain.ts`: `0343AB5AF9C10A1AF2911FE69325CA6029E7023275A76BEB80405C3C4D57857B`
  - `src/host/services/scheduler.ts`: `B133C384A0F0E34A609676EBA20BD3E83357682958107B25B404FCB4A6094B89`
  - `src/providers/local.ts`: `14D2649C554AE2C41D3112C05609BF2C1907C7E1DED3FD19EE1DD7571F17AA8E`
  - `src/index.ts`: `16DC2940702635FAA853FA89509DEDF1A9C101AD6EF51AF3992802C6355421A2`
  - `src/client.tsx`: `C6F7FFDB558832D20B6DD744D67049920936DFF41D2463609D19D2732D8A930A`
- 包名、版本、SHA-256：`dsh-table@0.1.0`，`.artifacts/dsh-table-0.1.0.tgz`，SHA-256: `D606839741814AE2C7A443D889FDE5E09C8CFC68B28CD501EAF11D23183C8DE9`（SHA-1: `38ae4667b0a4b1362000c2248184be6b6344d4f2`）
- 实际安装目标/profile/模式；部署ID：NOT_RUN（遵守规则：本轮候选包未部署至用户的日常 desktop profile，不强杀正在运行的进程，等待安全维护窗口或用户指定）。
- 安装文件与候选包是否一致：解包独立冒烟已通过。

## 6. 开放问题与下一位的具体动作
| 优先级 | 问题ID | 事实与来源 | 下一步动作 | 完成时必须看到的证据 | 依赖/阻塞 |
| --- | --- | --- | --- | --- | --- |
| 高 | T-009/T-002 | 新候选包已就绪（SHA-256 D60683...），尚未在真实 DSH 宿主环境部署加载 | 在隔离 profile 或待安全窗口安装该候选包；核对运行加载版本；获取真实办公任务材料读取与受控工具执行证据 | 真实 DSH 宿主加载日志与成果文件落盘 | 需要真实宿主启动 |
| 高 | T-007 | 本端 T-011 已闭环修复并通过所有反例；真实 Mac 对端联调待开展 | 保持 Windows 权威不变，核对 `dsh-remoteconnect` 公开契约与实际网络传输 | S2/S3 双端联调数据一致性记录 | 依赖真实 Mac 或 remoteconnect 服务 |
| 中 | T-006 | 界面对账按钮与状态徽标已在打包代码中验证；真实桌面交互未验 | 在实际启动的 DSH 桌面中体验多轮对话、拖卡、停止与一键解除待核对 | 桌面交互与截图/录屏核验 | 依赖 DSH 启动 |

- 下一位第一条可执行动作：
  运行 `node scripts/audit-remote-boundaries.mjs` 和 `node --test tests/reconciliation_t012.test.mjs`，确认 T-011 与 T-012 全部 PASS。接着推进 T-009/T-002 宿主环境加载测试。
- 可并行推进的独立事项：
  核对 `docs/REMOTECONNECT_CONTRACT.md` 与对端公开契约。
- 需要用户参与吗：
  当前无需用户操作，所有代码与测试均已自动化通过。当用户希望在真实 DSH 桌面查看最新效果时，再在空闲时热更部署或重启 DSH。

## 7. 交接自查
- [x] 已独立审核上一轮，说明证据和不同意见。
- [x] 已记录实际变更、设计理由和未完成部分。
- [x] 03-STATE已更新，04-LOG已追加，相关旧状态已校正。
- [x] 证据绑定当前版本；模拟、模型、宿主、桌面和跨设备分开。
- [x] 保留他人改动；释放本轮自有占用；未擅自提交或发布。
