# 轮次索引：dsh-table

只追加，不抹去旧结论。默认读最新完整记录，旧轮次按需查。每轮记录上一轮审核、实际实现与验证；04-LOG仅做索引，当前开放状态只维护在03-STATE。

| 轮次 | 日期 | 类型/范围 | 记录 |
| --- | --- | --- | --- |
| 20261023-000-bootstrap | 2026-10-23 | 持续交接文档初始化；未做产品验收 | [完整记录](rounds/20261023-000-bootstrap.md) |
| 20261023-1636-continuity-review | 2026-10-23 | 独立审核+连续性缺陷修复（T-001 关闭、T-004 代码部分）+真实模型验证+重建部署+交接 | [完整记录](rounds/20261023-1636-continuity-review.md) |
| 20261023-2200-remote-contract | 2026-10-23 | 独立审核上轮（全部成立+1 项记录漂移更正）；T-007 可独立部分：RemoteProvider 对齐 0.1-draft 契约（身份/版本协商、错误词表、clientRequestId 幂等、generation 失效）+S2 等价性 9 项测试；T-010 关闭（BRIDGE_AUTH.md）；重建部署 | [完整记录](rounds/20261023-2200-remote-contract.md) |
| 20261023-2133-execution-safety | 2026-10-23 | 独立审核；防重复执行、原子领取、unknown恢复保护及真实停止回执；常规测试隔离；73项72过1跳过；独立Remote反例2项FAIL，新包未部署 | [完整记录](rounds/20261023-2133-execution-safety.md) |
| 20261024-1430-remote-boundaries-reconciliation | 2026-10-24 | 独立审核上轮；修复并关闭 T-011（代次变更旧响应丢弃、写请求 UNKNOWN_OUTCOME、身份一般错误阻断，反例脚本 2/2 PASS 并纳入回归）；闭环并关闭 T-012（Worker/Host 自动查询、对账与解除未知保护机制，防改卡绕过守卫，控制路径与界面一键核验）；全量 81 项回归 80 过 1 跳过，真实模型 5 项全过，新候选打包 | [完整记录](rounds/20261024-1430-remote-boundaries-reconciliation.md) |
| 20261024-1445-iso-host-boot | 2026-10-24 | 独立审核上轮（全部成立）；T-009 主体闭环：隔离 profile（dsh-table-iso）真实 dsh 0.2.1-rc.2 宿主干净启动，发现并修复 3 项宿主集成契约缺陷（工具 output/execute 契约、webServer.register exact 路由+admit 鉴权围栏、systemPrompt.section、ctx.reflect 可选服务访问），新增契约镜像回归与 11 项端到端验证脚本全 PASS；真实模型办公任务两轮闭环（1794/2210 字交付物落盘、状态诚实流转）；desktop profile 因 dsh-remoteconnect 客户端打包缺陷 web boot 崩溃（归该项目），未并行部署；候选包 c2d70225... 替代上轮未部署候选 | [完整记录](rounds/20261024-1445-iso-host-boot.md) |
| 20261024-1640-desktop-panel-reflow | 2026-10-24 | 独立审核上轮（实测数据全部成立；“desktop 被 remoteconnect 阻塞”已过期，本轮更正）；T-009 收口：desktop 日常实例升级并真实重启验收（13/13 PASS + CDP 面板可视证据）；修复面板注册契约（main keyed slot + sidebar.panellist 成对，去掉 fixed 覆盖层）；新增后台成果自动回流主对话（严格一次、结论诚实）与一句工作指令自动建卡派发（复用/不误建卡）；界面状态码全部业务化中文；回归测试隔离不再写用户工作区；全量 90 项 89 过 1 跳过 0 失败；候选包 E0EF98E9... | [完整记录](rounds/20261024-1640-desktop-panel-reflow.md) |
| 20261024-1745-cli-install-desktop-interactions | 2026-10-24 | 独立审核上轮（全部成立；T-015 归因修正：CLI 安装元凶是 remoteconnect 依赖行 registry 404 而非 dsh-table 行）；T-015 闭合：修复共享 profile 依赖行后 `dsh plugin add` 成功、lockfile 正规化、安装后 13/13 复验；T-006/T-003 主体闭合：CDP 真机交互点验 U3 全链路 5/5 PASS（开面板/@任务派发/停A保B/已停卡复跑/停止全部，console error 0，截图+DB 双证据）；API 受控停止测试证明停止路径产品层无缺陷；T-001/T-004 探查完成（session/agents 服务面已探明）；src 零改动，候选包 E0EF98E9 未变 | [完整记录](rounds/20261024-1745-cli-install-desktop-interactions.md) |
| 20261024-2045-host-session-bridge | 2026-10-24 | 接管 token 耗尽中断且无交接的 Agent（autoclay 遗产经实物考古全部成立并保留：DshHostSessionBridge+集成+替身测试，其 GBK 损坏修复验证完整）；真机验证暴露并修复宿主会话桥接空页缺陷（page throughSeq:-1 恒空页→改 snapshotEvents）+ 模型层错误诚实透出 + 复用会话也 pin；三项环境根因实证（workbuddy 渠道内容过滤拒宿主完整提示、deepseek-account 冷启动竞态、同版本重打包须 remove+add）；决定性验证：真实 desktop 宿主 agent loop + 用户指定 gpt-6-luna 回复 replied、assistant_state 绑定真实宿主会话（sessionMode=dsh-session-controller）、13/13 端到端；用户在绑定会话原生实测 ask-user-question 澄清；全量 103 项 102 过 1 跳过；候选包 8a809d2d 已装 desktop | [完整记录](rounds/20261024-2045-host-session-bridge.md) |

| 20261024-2310-continuity-publication | 2026-10-24 | 独立审核并收紧上一轮完成口径；有界入口上下文投影、会话重建去重与宿主错误防双发；0.1.1 候选；105过1跳过，辅助通路真模型3轮通过；候选未部署；白名单脱敏公开及上游许可 | [完整记录](rounds/20261024-2310-continuity-publication.md) |
