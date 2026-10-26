# 网页审查入口：0.1.2 源码候选

**2026-10-26 更新：当前 0.1.3，137 项回归通过；原生请求和 Mac relay 接线见 [ADR 0003](adr/0003-remoteconnect-relay-and-native-requests.md)，真实部署/分层证据见 [当前轮次](../handoff/rounds/20261026-feedback-github-deploy.md)。下文是 0.1.2 审查基线的历史记录，其“尚未接线”不能再直接描述新代码。**

更新：2026-10-25（Asia/Shanghai）。本轮供外部审查，未部署新版本。请以所在提交的源码为准，历史轮次的完成结论不是验收证据。

## 版本与真实状态

| 对象 | 本轮事实 |
| --- | --- |
| main | 0.1.2 源码，包含前几轮未发布改动和本轮独立修复 |
| codex/packages | 仍为 c6f36711a4e1833f8b9fc11fe1175bf638dccd60，预编译 0.1.1；与 main 是不同历史 |
| Windows desktop | 只读安装元数据仍为上述 GitHub 0.1.1；本轮未安装、重启或实测运行版本 |
| Mac | UI 仍调用本机 /api/workbench；RemoteProvider 未装入产品。直接安装不能访问 Windows 同一任务库 |

## 这次可以审什么

1. 前轮保留：任务创建事务、SQL revision 条件更新、busy_timeout、JSON 读取容错、调度异常兜底、面板 ErrorBoundary、Cordis 可选服务降级、T-017 跟踪骨架。
2. 用户决定的移除：DshAIClient、直连凭据/文本生成链路及桥接专用测试删除。主助理仅走宿主会话；Worker 无可用宿主执行器时阻塞，不声称业务完成。
3. 本轮新增：补齐实际遗漏的项目创建事务；主助理失联、查无会话和观察超时保持可持久恢复的 unknown；停止 ACK 不当成退出；控制聚合保留 conflict；主入口“核验”包含宿主状态；旧异步回调在停止/卸载后失效；晚到正文、事件和 pending 清除同事务提交。
4. 本轮新增：依赖 JSON 损坏时保留列表可读，但准入、依赖图检查及普通改卡拒绝静默丢掉前置条件；只有明确更新依赖才能修复。
5. 本轮新增：每次测试先清理并重建 lib，避免已删除桥接产物残留入包；清理仅限经路径和链接检查的本项目 lib。同步 package-lock 的 0.1.2 身份。
6. 公开导出按上一份清单安全删除未改动的旧文件，未知文件和编辑过的旧文件会阻断导出，不会被清理。

优先文件：[host-tracker.ts](../src/host/services/host-tracker.ts)、[domain.ts](../src/host/services/domain.ts)、[local.ts](../src/providers/local.ts)、[index.ts](../src/index.ts)、[新增故障回归](../tests/host_tracker_safety.test.mjs)、[构建清理](../scripts/clean-build.mjs)。

## 验证范围

| 层 | 本轮结果与边界 |
| --- | --- |
| STATIC | typecheck、干净构建通过；Host/Client 生成产物契约由测试执行 |
| UNIT/MOCK | 131 PASS，0 FAIL，0 SKIP；原基线 116 PASS；先加入的 7 个负例修改前全部 FAIL、修复后通过 |
| MODEL | NOT_RUN；未调用在线模型 |
| HOST | NOT_RUN；未启动或操作真实 DSH 宿主 |
| DESKTOP | NOT_RUN；未重装或重启原桌面 |
| REMOTE / MANUAL | NOT_RUN；未进行 Mac/跨设备或人工体验验收 |

复现：Node 24，`npm ci --ignore-scripts --legacy-peer-deps`，`npm run typecheck`，`npm test`。pretest 自动清理构建，构建失败不会继续测试。测试有控制器、执行器替身和临时文件；替身写文件只证明结果管道，不能当成真实办公/代码业务完成。

## 希望重点挑战的未闭环问题

- T-002：默认 Worker 仍只探测可选 agentRunner.executeTask；未接入真实独立项目根 Session、工具与权限范围。
- T-017：原 2/5 测试的 tracker 与 apply 使用的 tracker 分离，只证明通用 prompt 路由。本轮已更名澄清；真实原生审批/问题需核对公开 interaction 请求与响应，不能把发送 followup 当成已回答原交互。
- 宿主 prompt 的实际 requestId 与 tracker ID 尚非同一受理键；ACK 丢失、多主入口并发与前台回复持久化崩溃窗口仍需专项核验。本轮停止观察保护不等于所有派发幂等问题已解决。
- Mac 的连接选择、公开扩展调用、身份展示和禁止本地建库门禁仍未实现；RemoteProvider 的 stub 测试不证明 UI 接线。
- 观察截止后保留 unknown，可从控制条再次核验/停止；宿主永远无法解析时仍需明确恢复策略，不应按时间自动宣布停止。
- rc.3、真实升级/回滚、原生交互与当前候选业务验收未运行。

请对每个发现给出文件、具体触发条件及后果，区分已证实缺陷、待验证假设与功能待办；不要根据历史测试数量推断业务成功。当前摘要见 [STATE](../handoff/03-STATE.md)，完整复核见最新轮次。原始会话、截图、数据库和部署证据留私有；公开历史里部分 evidence 链接因此不提供原文。
