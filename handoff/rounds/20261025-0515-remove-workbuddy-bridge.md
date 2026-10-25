项目：dsh-table

# 20261025-0515-remove-workbuddy-bridge：按用户决定移除 WorkBuddy 文本桥接（0.1.2）

## 1. 身份与输入
- roundId / 时间：20261025-0515-remove-workbuddy-bridge / 2026-10-25 19:00 → 19:40（Asia/Shanghai）
- Agent：ZCode（GLM-5.3-Flash）；上一轮：[20261025-0445-external-review-audit.md](20261025-0445-external-review-audit.md)
- 输入：0.1.2 工作树（含上一轮未提交的加固改动）；用户两条直接指令：①"workbuddy bridge 不用恢复，直接去掉"；②"暂时不用任何直接测试，先调整插件本体"，随后澄清"只要 commit+push 提示词"
- 占用 owner / 范围：zcode-glm-20261025-r2 / src/ tests/ scripts/ docs/ handoff/

## 2. 对上一轮的审核
上一轮（外部审查加固）全部保留；本轮在其上执行用户的移除指令。无新审核发现。

## 3. 本轮实现
| 变更 | 说明 |
| --- | --- |
| 删除 `src/host/services/ai-client.ts` | DshAIClient（WorkBuddy 桥接直连客户端）整体移除；`src/index.ts` 去除 import/导出/config 三字段（aiBaseURL/aiApiKey/aiModel）/实例 |
| Worker 执行器 | 删除"分支2：桥接文本生成+成果落盘"整段；诚实失败文案更新（桥接已移除，指向 T-002 宿主会话化）；分支1（宿主 agentRunner）与边界检查保留 |
| 聊天路径 | 删除讨论分支与最终问答分支的两处 `aiClient` 回退；文本生成只余宿主会话一条通路 |
| capabilities | executionBackend 只披露 `host-session-controller` 或 `standalone-local`；textGeneration=宿主桥接可用性；移除 model 字段与 workbuddy-bridge 值 |
| 测试 | 删除 `tests/host_ai_integration.test.mjs`（门禁真模型桥接测试，前提消失）；`continuity_history` B 组（stub 桥接捕获请求）删除——模型上下文权威已移交宿主会话（raw 模式由 verify-host-continuity 真机覆盖）；`work_control_e2e` 12/15 重构：边界半区用产品默认执行器（内置物理边界检查），成果半区注入同契约 executor 验证 artifactRefs→Result→回流链路 |
| 脚本 | `verify-host-iso.mjs`：删桥接探测用例；能力断言改为 host-session-controller/standalone-local 二值强校验；Run 收敛建立为诚实终态（blocked/review/done）；删 `probe-bridge-stream.mjs`（上轮临时诊断代理 bridge-debug-proxy 已随上轮清理） |
| 文档 | 删除 `docs/BRIDGE_AUTH.md`；ADR 0001 的桥接记载属历史记录保留 |
| 版本 | package.json → **0.1.2** |
| iso patch | 移除 llm-pi-ai workbuddy-bridge provider；hostSession.model pin 改 `openai-codex/gpt-6-luna`（与 desktop 一致） |

## 4. 验证（仅单元层，遵用户指示）
- typecheck/build 退出 0；`npm test` **116 项全过 0 失败 0 跳过**（桥接门禁测试已删故无 SKIP）。
- 真机/桌面/远程：按用户指示 NOT_RUN（用户将人工测试 + 后续场景测试）。
- 教训记录：注入 workerExecutor 会整体替换默认执行器（含物理边界检查）——E2E 曾因此让"目录不存在"用例误通过（executor 的 mkdirSync 造出了目录），已按"边界半区默认执行器/成果半区注入"拆分；误建目录已清理。

## 5. 版本
- 包：`dsh-table@0.1.2`（未打包 tarball——commit/push 由用户的 GitHub Agent 执行）；关键哈希：index.ts `ba510cc8...`、work_control_e2e `8c3c5946...`、continuity_history `d6372875...`、verify-host-iso `75ffaa03...`
- desktop 仍运行 github c6f3671（0.1.1）——本次 push 后可升级；iso 未动本轮产物（无真机验证）。

## 6. 下一位动作
1. push 后：desktop 从 GitHub 升级 0.1.2，跑 `verify-host-iso.mjs` 14 项（注意 Run 用例现预期诚实终态而非桥接交付）。
2. T-002 主线：Worker 接宿主独立项目根 Session（桥接移除后这是 Worker 获得模型能力的唯一通路）。
3. 用户人工测试时注意：无宿主桥接的独立环境里，聊天将如实披露无文本生成（standalone-local）。

## 7. 交接自查
- [x] 用户指令为准（移除桥接、不做直接测试）；单元层保持全绿以保证可提交
- [x] 记录完整；03-STATE/04-LOG 已更新；锁已释放
- [x] 未 commit/push（留给用户的 GitHub Agent）
