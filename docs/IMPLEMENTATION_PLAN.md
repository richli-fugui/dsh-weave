# 工作台实施计划

当前没有实现。按阶段通过，不把文档或UI截图等同于完整链路。

## Gate 0：环境、底座与许可

- 定位当前Windows/Mac DSH发行版、版本、HOME、profile、实际运行实例与活跃任务。
- 锁定Dely0工作台具体release/commit，检查许可证、任务schema、迁移、服务端状态、Client资源和公开扩展点。
- 用ADR决定唯一任务权威、沿用/改造范围与数据兼容策略。上游许可不适合计划发布方式时先报告，不能用本项目MIT覆盖。
- 只读查看dashboard与旧卡的必要字段；不运行旧派发器、不批量扫描所有项目。
- 和远程项目核对docs/REMOTECONNECT_CONTRACT.md中的草案。两个Agent未获用户授权不得擅自互发任务消息；可在各自仓库留下接口文件供操作者转交。
- 当前仓库只放可公开样例，真实路径和任务数据留私有目录。

产物：ADR、兼容矩阵、依赖锁定、字段映射和接口差异。未经检查不直接把多个插件安装到真实DSH。

## Gate 1：插件骨架与单一业务接口

实现Host/Client拆分、持久化、迁移、revision、领域事件和LocalProvider。
搭建主对话+任务区壳；先不做花哨日历、角色市场或复杂统计。
形成Project/Task/Run/Result/Assistant稳定ID与错误类型。
用隔离DSH profile加载打包插件，证明读取当前Host信息和生成API调用有效。

退出：真实DSH中加载，任务数据可保存、重启可读；本地Client不直接写文件型卡池。

## Gate 2：项目与任务卡

实现：
- 绑定Windows现有Workspace/目录，新建项目不会搬文件；
- 卡片创建/编辑/分组/筛选/详情/状态；
- 小步任务、目标和验收，不强制把所有事情拆成文档工作；
- 依赖校验、去重、CAS冲突与持久事件；
- @任务选择器和拖卡，结构化ID引用；
- 只读旧卡导入、预览、依赖映射与重复导入幂等。

退出：导入样例可复现；数据不依赖浏览器缓存；打开两个本机窗口不会丢更新。

## Gate 3：主助理与后台执行闭环

实现主助理的任务工具、从明确意图建卡、单卡/多卡推进。
Host调度器持久队列、并发与同项目冲突控制。
DSH worker适配器创建正确项目根Session，按任务最小上下文执行。
回收结构化结果和成果引用，区分Run结束与Task完成。
审批、用户提问、阻塞在主入口集中处理。
主入口可继续普通聊天，不因为worker运行强占用户输入。

退出：真实DSH执行至少一项隔离代码任务、一项非Git/文件交付任务；无需人工打开worker对话，成果落在正确项目。

## Gate 4：上下文、记忆和恢复

实现有界个人/项目索引、TaskBrief、证据来源与按需检索。
接原生compaction；逻辑主入口和底层Session绑定分离。
实现安全轮换、待处理输入保护、持久结果Outbox和去重。
实现调度崩溃窗口、未知受理结果对账、原Session恢复。
不引入必需外部向量服务；不复制详细worker日志进入主上下文。

退出：轮换主Session时worker结果不丢；重启后Run不会盲目重复执行；超过上下文阈值仍可继续原逻辑入口。

## Gate 5：接入Remote Connect

RemoteProvider消费远程项目提供的服务，复用与LocalProvider相同工作台领域接口。
Mac安装工作台前端，Windows工作台后端为唯一数据权威。
校验远端host/profile/protocol/capabilities；不兼容明确阻塞。
先用connector stub测试，再用实际远程插件与真实Mac DSH联调。
实现任务状态push、附件远端路径、断线/unknown显示、旧代次响应隔离。

退出：Mac主对话发起任务，Windows执行，双端同一任务/Run/Session可核对。Mac退出不停止已受理任务。连接插件未就绪时此阶段BLOCKED，不能用本机测试替代。

## Gate 6：部署、回滚与验收

交付tarball、部署检查/计划/安装/验证/回滚工具。
先隔离profile验证，再按用户施工授权安装到当前Windows实例，Mac正确安装Client。
核对原会话/项目、数据库迁移、私有备份与卸载保留数据。
执行VERIFICATION，填写ACCEPTANCE与已知限制。
补README真实命令、兼容版本、界面证据与上游许可。
未经用户指令不commit/push/发布。

## 建议代码结构

src/host：领域服务、数据库、调度、DSH adapter、Outbox。
src/client：主入口、卡片、引用、审批与详情。
src/shared：协议、schema、状态与错误。
src/providers：LocalProvider/RemoteProvider。
src/importers：旧Markdown导入。
tests：单元、真实DSH、恢复、远程、Mac。
scripts：doctor、deploy、rollback、脱敏报告。

是否沿用上游目录按ADR决定，不为目录对称重写稳定模块。

## 交付清单

源码和锁文件；可安装tarball与哈希；真实部署记录；数据库备份/迁移/回滚；自动化结果；Mac实机证据；逐项验收；远程接口兼容矩阵；第三方许可；未完成/未支持的精确范围。
