项目：dsh-table

# 轮次记录：20261025-0420-audit-and-ui-labels

## 1. 身份与输入
- projectId / 实际绝对根目录：dsh-table / `<LOCAL_PATH>`
- roundId / 开始与结束时间：`20261025-0420-audit-and-ui-labels` / 2026-10-25 04:00 - 04:25（Asia/Shanghai）
- Agent或工具 / 模型：Antigravity
- 上一轮记录路径：`handoff/rounds/20261025-0330-raw-continuity-t017.md`
- 输入版本：0.1.1 uncommitted/working-tree
- 当前占用文件owner / 本轮允许写入范围：`agent-audit-20261025` / `handoff/`, `src/`, `tests/`, `scripts/`
- 本轮目标及对应计划阶段：全项目深度自检、隐患修复、状态语义收敛与自动化回归

## 2. 对上一轮的独立审核
| 上轮主张/问题 | 本轮复核动作与证据 | 结论（成立/部分/不成立/未验证） | 是否需修复 |
| --- | --- | --- | --- |
| T-017 宿主 pending 提问识别/投影/主入口统一作答/停止联动/晚到回复回流 | 运行 `tests/host-pending-t017.test.mjs` 5/5 全部 PASS；探测端口 57431 真实宿主会话绑定正常 | 成立 | 否 |
| 全套自动化回归 111 项 | 运行 `npm test`：110 PASS，1 SKIP，0 FAIL | 成立 | 否 |
| 远程边界审计 2/2 PASS | 运行 `node scripts/audit-remote-boundaries.mjs`：T-011a PASS，T-011b PASS | 成立 | 否 |

## 3. 本轮实现与理由
| 文件/模块 | 改了什么 | 为什么这样改 | 替代方案/取舍 | 影响与回滚 |
| --- | --- | --- | --- | --- |
| `src/client.tsx` | 增加 `runStateLabel`，将控制条状态切片中文业务化（`running`→`推进中`，`awaiting_input`→`等待输入`等）；控制条增加 `awaitingCount` 呈现与“等待你的回复”提示 | 消除直接向用户暴露英文内部状态码的规则违规；改善待决提问的视觉感知 | 无，必须符合文案业务语义规则 | 若回滚则恢复原始码 |
| `scripts/bundle-client.mjs` | 将写死的 named imports 正则改为通用 ESM 解构转 CJS require 转换器 | 引入 React Fragment 等新 JSX 特性时不会导致 `import` 语句遗留在 CJS 产物中 | 手动逐个追加正则容易遗漏 | 提高打包健壮性 |
| `src/providers/local.ts` | `followEvents` 定时器添加 `timer.unref()`；`stopIntent` 聚合 `schedStop` 与 `hostStop` 状态 | 消除事件循环无谓常驻；防止 `waiting_tool_exit` 状态被无条件吞并 | 独立包装 poll | 安全无破坏性 |
| `src/host/services/host-tracker.ts` | 增加 `startSettlingWait(sessionId)` 后台观察收敛机制 | 防止工具延迟退出时 `stopped` 状态永久停留在 `stopping` 快照中 | 强制超时清空可能误判还在跑的工具 | 定时器自动 unref 安全可靠 |
| `src/index.ts` | 增加 `ctx.on('dispose')` 清理；自然语言停止/答复反馈文字状态中文业务化；Worker 执行器接收 `context: { runId }` | 插件卸载避免 timer/DB 句柄泄露；对话体验更自然；为 T-002 绑定 Worker 会话打基础 | 忽略 dispose 会在重载时泄露资源 | 纯正向增益 |
| `src/host/services/domain.ts` | 增加 `attachWorkerSession(runId, workerSessionId)`；消息外键降级软保护 | 使得异步创建的 Worker 宿主 Session 能够持久化到 runs 表供重启对账；防止无效 intentId 丢消息 | 仅在启动前传 session 无法满足动态会话 | 安全向后兼容 |
| `src/host/services/scheduler.ts` | `WorkerExecutor` 类型扩展可选 `context: { runId }`；中断退出完整保留 Worker 已产出成果 | 避免中断时已有成果物被清空为仅有原因字符串 | 抛弃成果会导致重续推进没有上下文 | 纯正向增益 |

## 4. 验证记录
| case/用户故事 | 候选版本/包哈希 | 环境及真实证据层 | 操作/命令与退出码 | 预期与实际 | PASS/FAIL/BLOCKED/NOT_RUN | 脱敏证据路径 |
| --- | --- | --- | --- | --- | --- | --- |
| TypeScript 类型检查 | 0.1.1 working-tree | STATIC | `cmd /c "npm run typecheck"` (exit 0) | 0 errors | PASS | 控制台输出 |
| 客户端文案契约回归 | 0.1.1 working-tree | UNIT/MOCK | `node --test tests/client_panel_contract.test.mjs` (exit 0) | `runStateLabel`、`taskStatusLabel`、`taskPriorityLabel` 业务中文全覆盖 | PASS | `tests/client_panel_contract.test.mjs` |
| 全套自动化回归 | 0.1.1 working-tree | UNIT/MOCK | `cmd /c "npm test"` (exit 0) | 111 项：110 PASS, 1 SKIP, 0 FAIL | PASS | `tests/*.test.mjs` |
| 远程边界审计 | 0.1.1 working-tree | UNIT/MOCK | `cmd /c "node scripts/audit-remote-boundaries.mjs"` (exit 0) | T-011a/b 2/2 PASS | PASS | `scripts/audit-remote-boundaries.mjs` |
| 桌面运行态端口探测 | 0.1.1 desktop | HOST | 动态探测 PID 45396 监听端口 57431 (exit 0) | snapshot 200, diagnostics 正常响应, agentStatus=idle, bound=true | PASS | 端口 57431 响应 |

## 5. 版本与部署
- 修改后代码经 `npm run build` 成功更新 `lib/`；
- 本轮为深度自检自查与代码质量加固轮次，未触发生产 profile 破坏性重载；
- 当前桌面 DSH 实例（PID 45396）持续正常服务于端口 57431。

## 6. 开放问题与下一位的具体动作
| 优先级 | 问题ID | 事实与来源 | 下一步动作 | 完成时必须看到的证据 | 依赖/阻塞 |
| --- | --- | --- | --- | --- | --- |
| 高 | T-002 | Worker 成果生成仍主要走工作台文本/模型桥接，需对接宿主独立项目根 Session 及真实办公/代码工具链与权限控制 | 现已打通 `attachWorkerSession` 与 `context.runId`，下一步为 Worker 实际对接宿主 Session | Worker 产出真实项目文件与验收标准核验通过 | 需宿主支持 |
| 中 | T-007 | 远程契约已通过 S2 替身与边界审计，真机 Mac 验收因无硬件处于 BLOCKED | 等待 D5 阶段 Mac 实机联调 | 真实 Mac 联通 Windows 权威 | 物理硬件 |
| 低 | T-016 | 历史验证卡及测试消息遵从规则保留 | 待用户明确授权后再清理 | 用户确认 | 用户授权 |

## 7. 交接自查
- [x] 已独立审核上一轮，说明证据和不同意见。
- [x] 已记录实际变更、设计理由和未完成部分。
- [x] 03-STATE已更新，04-LOG已追加，相关旧状态已校正。
- [x] 证据绑定当前版本；模拟、模型、宿主、桌面和跨设备分开。
- [x] 保留他人改动；释放本轮自有占用；未擅自提交或发布。
