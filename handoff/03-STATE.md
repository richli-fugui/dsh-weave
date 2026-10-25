# 当前状态：dsh-table

更新时间：2026-10-25（Asia/Shanghai）。最新轮次：[20261025-194927-review-publish](rounds/20261025-194927-review-publish.md)。网页审查入口：[REVIEW_GUIDE](../docs/REVIEW_GUIDE.md)。

阶段：**0.1.2 源码审查候选**。用户授权独立审核、改进、脱敏 commit/push 到 GitHub main，供网页审查；实现提交 34ac1a37b4d1e58a3a575dd4974f5ad695a14ba9 已推送并从 GitHub 回读核实。不发布 npm、不改安装分支、不重装/重启桌面。

## 当前事实

- 原始工作区 Git 无提交，保留他人未提交改动；公开 Git 历史在 .public-export。本轮前 main 为 cab82da9082146a41e385dfb64b873eb909ff7e8；安装分支为 c6f36711a4e1833f8b9fc11fe1175bf638dccd60，两者不能混称。
- 前几轮加固、T-017 跟踪骨架和用户指定的 WorkBuddy 文本桥接移除保留。0.1.2 源码与 package-lock 身份现一致；主助理仅宿主会话，默认 Worker 缺宿主执行器时阻塞。
- 本轮修复：项目创建事务遗漏；宿主失联/查询异常/观察截止误报停止并遗失控制；停止 ACK 与终态混淆；停止聚合丢 conflict；旧回调在停止/卸载后继续写；晚到回复与 pending 清除崩溃窗口；损坏依赖误放行；删除源码后 lib 残留进入包。
- npm test 现自动清理并重建生成目录；公开导出可安全删除上次清单中未编辑的过时文件，仍拒绝未知/编辑文件。
- Windows desktop 本轮只读安装元数据：dsh-table 仍为上述 GitHub 固定 0.1.1；Remote Connect 依赖已为 v0.1.19，未改动。当前运行版本/活跃任务未重新实测，不从安装元数据推断已加载。
- Mac 不是仅缺实机：Client 硬编码本机 /api/workbench，Host 无 Mac 禁止建库模式，RemoteProvider 尚未装入产品。当前不能让用户直接安装来访问 Windows 同一工作台。

## 验证边界

| 层 | 本轮结果 |
| --- | --- |
| STATIC | typecheck、干净构建 PASS；打包 dry-run 69 文件、Host/Client 入口齐全、残留桥接 0 |
| UNIT/MOCK | 基线重建后 116 PASS；本轮最终 131 PASS，0 FAIL，0 SKIP；7 个先写负例修改前全 FAIL，修复后通过 |
| 公开副本 | 独立脱敏副本离线安装、typecheck、131 项回归全通过；101 文本文件索引/清单一致；GitHub 固定提交审查页已回读。原始 evidence/数据库/截图/记忆不上传 |
| MODEL / HOST / DESKTOP / REMOTE / MANUAL | 本轮全部 NOT_RUN；历史证据只属于其当时版本，不自动覆盖 0.1.2 |

## 开放问题

| 优先级 | ID | 事实与下一步 |
| --- | --- | --- |
| 高 | T-002 | 默认 Worker 仍只探测可选 agentRunner.executeTask；按真实公开类型接独立项目根 Session、工具与权限，验证真实代码及办公任务 |
| 高 | T-017 | 原生问题/审批尚缺正式 interaction 响应契约与实证；旧 2/5 测试 tracker 与 apply 分离，现已更名纠正。不能以 followup prompt 当作已回答原生交互 |
| 高 | T-007 | RemoteProvider 单独 mock 通过，产品 Mac 接线与禁止本地权威门禁缺失；先核对 Remote Connect v0.1.19 公开扩展能力，再接 UI/Host |
| 中 | 主入口并发/受理 | tracker ID 与宿主实际 requestId 未统一；ACK 丢失、并发输入、前台回复持久化窗口仍需专项。停止观察修复不等于所有派发幂等已完成 |
| 中 | 0.1.2 部署 | 用户当前要源码供审查，未更新安装分支。试装前按部署租约、备份、隔离包/宿主/Client验证，再串行升级，不直接装 main |
| 低 | rc.3/T-016 | rc.3 未实测；历史验证卡/消息未清理。保留原数据，不擅自删除 |

## 下一位第一条可执行动作

先运行 npm run typecheck、npm test 确认当前 131/131 基线（测试会自行重建），再读取 docs/REVIEW_GUIDE.md，按外部反馈定位真实源码和触发条件。若继续施工，优先对照目标 DSH 公开 Session/interaction 类型，列出问题/审批请求 ID、回答方法、取消与生命周期实际契约；必须取得真实待决交互从同一主入口作答后解除的证据，不能沿用旧 2/5 测试结论。

后续选择 T-002/T-007 时，取得真实项目根/权限或真实公开远程扩展调用证据；缺设备只阻塞实机层，不把未实现部分写成缺硬件。当前无需用户做安装操作。
