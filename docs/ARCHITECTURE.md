# 工作台技术方案

日期：2026-10-23。设计与部分实现并存；当前源码/已装版本和验收边界以 handoff/03-STATE.md 为准。

## 1. 用户工作流

用户持续在一个主助理入口聊天。想法可以转为任务提案，明确“拆成任务卡”后创建卡片。项目分组展示任务，项目绑定Windows现有文件夹。

用户拖入或@引用A/B/C卡并说“推进这些”，主助理读取最新卡片和必要项目摘要，建立执行计划。后台按依赖与资源约束开工。普通步骤直接推进；工具审批、提问、阻塞和结果回到主入口。用户不必打开后台Session。

任务执行完提交结果与证据，待验收卡由用户确认或按已配置明确规则处理。单次执行结束不是自动完成整张任务。

## 2. 界面

首屏以项目分组任务区和一个主对话区构成。后台Session只在调试/追溯详情中查看。

- 项目：名称、Windows目录连接状态、当前目标简述。
- 卡片：标题、状态、依赖、下一步、执行活动与待确认标识。
- 主输入：文字、图片/附件、@任务选择、拖入卡片形成结构化引用。
- 主消息区：对话、任务创建/启动回执、审批/提问、阻塞与简短结果。
- 任务详情：目标、验收、当前事实、执行记录与成果链接。
- 顶部始终显示当前Host/profile；Windows离线时不静默使用Mac执行。

拖入一张卡不会立即开始执行；引用与执行意图分开。引用携带host/profile/project/task稳定ID，不靠标题匹配。引用已删除/过期卡时显示原因，不能替换成名字相似的卡。

手机拖拽不是首版要求；后续可沿用@或选择器。iPhone原生客户端暂不承诺。

## 3. 模块与部署

Mac DSH：本地工作台前端 → Remote Connect服务 → Windows DSH工作台后端 → DSH原生Session/Agent与现有项目。

Windows本地工作台走相同领域接口，只用LocalProvider。RemoteProvider依赖远端控制项目；两者共享同一业务contract，不各写一套功能。

| 模块 | 权威与职责 |
| --- | --- |
| 工作台Domain | Windows上的项目、任务、依赖、执行、结果、主助理绑定 |
| 调度器 | Windows上决定可执行项、领取与执行记录、可恢复派发 |
| DSH适配器 | 调用目标版本公开Session/Agent/权限/日志接口 |
| 上下文与记忆 | 有界主助理上下文、项目/任务摘要、按需检索、会话轮换 |
| Client UI | Mac或Windows渲染，缓存可丢，远端身份明确 |
| Remote Connect | 网络、认证、Peer、流、重连；不拥有任务数据 |

**客户端面板装配（2026-10-24 实测宿主契约）**：DSH 客户端插件的全局面板入口在 root 作用域 `sidebar.panellist` 注册图标；同一个 panel id 必须同时在 root 作用域 `main` keyed slot 注册内容，点击才由 `layout.selectPanel(id)` 渲染。只注册图标会导致点击后没有面板内容（宿主保留原面板）。因此本插件成对注册，内容组件铺满面板容器，不使用 fixed 全屏覆盖层。回归固化见 `tests/client_panel_contract.test.mjs`。

首版使用一个任务数据库。优先改造Dely0既有SQLite领域和迁移；必要的扩展表引用其任务ID。不得同时维护另一个SQLite卡池、旧MD池和多个插件任务库的双向写入。

## 4. 数据模型

以下是业务模型，不是已存在的DSH字段；按选定底座适配并记录ADR。

- Project：id、title、host/profile范围、workspaceId、rootPath、goal、status、revision。
- Task：id、projectId、title、goal、acceptance、status、priority、dependencies、revision、created/updated。
- Run：id、taskId、clientRequestId、state、workerSessionId、permissionsRef、started/finished、outcome。
- Result：id、runId、summary、artifactRefs、evidenceRefs、nextActions、reviewState。
- Assistant：stableId、currentSessionId、generation、memoryIndexRef；稳定助理身份与Session分离。
- Decision：scope、content、source、confirmedAt、supersededBy。
- ProjectBrief/TaskBrief：sourceRevision、summary、lastVerified、links；派生摘要可重建。
- Event/Outbox：sequence、entityId、revision、type、payload、deliveryState；支持UI追赶和主入口结果汇总。

绝对路径是机器私有配置，不是项目身份。项目改名/移动需要显式更新绑定；数据不迁进工作台目录。目录不存在、盘未挂载或无权限时阻塞并显示，不能在Mac创建同名目录。

## 5. 任务与执行状态

任务建议状态：todo、in_progress、blocked、review、done、cancelled。
执行建议状态：queued、running、awaiting_input、completed、failed、interrupted、unknown。

- 一张任务可有多次Run与多份Result。
- Run completed表示本轮结束；进入review或继续待办，不能直接等于Task done。
- awaiting_input进入主入口的待确认区；不能无限显示“仍在运行”。
- 失败和未知结果保留证据及恢复入口，不把重试按钮变成默认重做全部副作用。
- 用户取消一张前置卡不自动等同完成依赖；后继卡需重新判断或调整。
- 依赖必须存在、无环。循环、跨Host和失效引用明确拒绝。
- 任务更新用revision/CAS，防止Mac和Windows同时编辑互相覆盖。
- 拆卡保留来源和父子关联；不要删除原始意图。

## 6. 对话、建卡与调度

主助理只持有必要工具：查询项目/任务、提出/创建/修改任务、启动/停止/查看Run、读取摘要与成果、请求需要的人工决定。

用户明确“帮我拆卡/推进”可授权普通持久化与执行，无需逐张重复确认。闲聊内容可提出关联建议，不自动把每个想法建成活跃任务。重要长期偏好或跨项目事实更新保留来源与确认状态。

批量推进：
1. 校验结构化引用、任务revision和权限；
2. 解析依赖，形成可执行队列；
3. 原子记录批次与待派发项；
4. 调度器领取，记录Run；
5. 调用DSH，并登记实际Session/执行关联；
6. 观察状态，保存Result；
7. Outbox向主入口投递摘要，失败可重试投递，不重做业务执行。

默认全局并发上限2，可配置；同项目默认串行，避免多人改同一文件。前置已满足且不冲突才并行。Git项目可后续增加worktree策略，非Git设计/素材项目也必须可用。

必须处理数据库领取与DSH受理之间的崩溃窗口。使用上游可用关联ID/幂等能力对账；无法证明没执行时标unknown，不盲目派发。分布式副作用不承诺普遍exactly-once。

## 7. 项目权限与执行Session

每个执行Run使用独立的项目根Session或经确认可恢复的对应Session。初次创建时把Windows正确root/cwd与DSH权限边界一并设置。

不得假设“从主助理派一个子代理、改cwd”就改变了sandbox可写根。主助理跨项目查询与worker文件写入权限是两回事。

worker只接收本任务目标、验收、必要决策、相关文件入口与当前摘要；不默认继承主助理全部私人聊天或其他项目日志。后台不静默扩大权限。

跨项目任务应拆分执行边界，以显式成果引用交接；不把所有项目根都授权给每个worker。

## 8. 上下文与记忆

一个逻辑入口不等于一个无限增长的模型Session。使用四层：

| 层 | 内容 | 加载规则 |
| --- | --- | --- |
| 个人偏好与助理身份 | 稳定、短、有来源的协作习惯 | 有界常驻 |
| 项目概览 | 项目目标、当前焦点、一行状态与入口 | 紧凑索引；相关项目按需展开 |
| 任务记忆 | 目标、决定、证据、卡点、下一步 | 被引用或派发时加载 |
| 执行原文 | 详细工具与会话记录 | 由DSH保存，需要时读取 |

worker结束只向主入口返回结构化结果、短摘要和成果引用，不追加全部日志。摘要必须有sourceRevision，过期则回读任务/项目真实记录。语义检索可后续接一个provider，不同时堆多个记忆写者。

首版不引入外部向量服务作为必需依赖。优先结构化数据、全文/词检索与显式引用；相关项目联想应标明来源，不把相似度当事实或执行授权。

## 9. 主助理Session轮换

复用DSH原生compaction，不另造底层压缩器。阈值按实际模型上下文窗口和预留量配置，不照抄固定超大token值。

轮换流程：
1. 检查当前无未处理用户输入、待提交审批或不可中断的主助理回合；
2. 持久化当前目标、已确认决定、待处理任务/问题、Outbox游标和检索入口；
3. 创建新底层Session，原子更新Assistant绑定/generation；
4. 新Session加载有界记忆与待办入口，回读必要事实；
5. 主界面维持同一逻辑入口，历史分段可追溯；旧Session保留。
6. 轮换中途崩溃可恢复同一结果，不重复新建和重放用户消息。

Run与结果归业务ID，不归当前主Session。主Session轮换期间worker结果照常落盘；摘要通过Outbox投递到当前绑定，去重后可见。用户不负责复制handoff或选择新对话。

主对话的显示历史可分页存在多个底层Session中；模型输入只加载相关部分。界面历史与模型上下文是不同概念。

## 10. 结果与验收

worker返回应包括runId、completed、blockers、artifacts/evidence、nextActions和建议状态。优先类型化工具返回与Host事件；正则解析Markdown作为兼容降级，不能成为唯一可靠控制面。

Host校验关联ID、结构与文件存在性，并区分：
- Agent声称完成；
- 成果可定位；
- 内容满足验收；
- 用户接受。

证据存在不证明内容正确。必要时按任务选择独立审核能力，默认不要求每次都经过Arthur→Judy→ChatGPT多层评审。

## 11. 数据恢复与事件

SQLite事务记录任务变更、Run关联与领域事件。UI通过baseline+有序事件或follow恢复；重连后从Windows回读权威状态。

领域通知Outbox持久化，但不复制DSH所有原始SessionEvent。未来schema升级前备份并做可重复迁移；旧版不能理解新schema时拒绝写入。

Mac网络断开后保留未发送草稿；已发送但未收到ACK的命令需查询clientRequestId结果。不能断线重试“全部任务”。

## 12. 旧资产迁移

旧ArthurOS任务卡和dashboard只作为迁移来源：
- 只读解析id/title/project/project_root/status/blocked_by/sessions与正文；
- 展示导入预览、状态与项目路径问题；
- 以origin+sourceId去重，保留旧ID映射、依赖与历史会话引用；
- 不把旧session字段直接当成已验证可续用的当前DSH Session；
- 旧Agent类型如Codex是历史引用，首版不自动改为DSH执行；
- 不改原卡、不删除、不双写。导入数据以导入时快照为准，之后新系统状态独立维护。

个人偏好和操作手册按需整理，不把ArthurOS整个目录或凭据目录注入记忆。旧状态和治理文档不自动成为新产品规则。

## 13. 第一版不做

不做独立Agent引擎、不做泛用个人操作系统、不做全盘自动扫描、不自动常驻监控全部项目、不实现自己的网络隧道、不接管Windows桌面、不承诺iPhone原生入口、不一次性内置多个外部模型CLI执行器。

首版价值是从主入口真正推进多项目任务，并能恢复与验收。

## 2026-10-24 连续性权威补充

逻辑入口消息、宿主执行上下文和领域状态的关系按 [ADR 0002](adr/0002-logical-chat-and-host-session.md)；宿主支持原生审批不代表工作台主入口已能回答，见 T-017。
