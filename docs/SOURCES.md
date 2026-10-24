# 参考、旧资产与证据边界

核查基准：2026-10-23。引用为本次讨论已读取的公开仓库和本地文件，不等于运行验证。施工时必须锁定release/commit、实际DSH版本和许可证。

## 推荐底座

- [Dely0/dsh-personal-workbench](https://github.com/Dely0/dsh-personal-workbench)
  已有自然语言录入、任务拆解、会话关联、完成申请/验收、本机服务端数据和UI；与本产品最接近。
  仍需改为单主入口、后台调度、远程服务接入与稳定上下文。
  上游写有多端同步后续计划，不能仅凭“本机存储”宣布跨设备即时一致。
- [任务数据读取](https://github.com/Dely0/dsh-personal-workbench/blob/main/src/client/hooks/useTaskData.ts)
  Client通过API拉取任务和详情。
- [刷新机制](https://github.com/Dely0/dsh-personal-workbench/blob/main/src/client/hooks/useWorkbenchPolling.ts)
  存在定时刷新；本产品状态变化需push并提供追赶，不把15秒刷新当远程体验目标。

## 上下文、执行与界面参考

- [Contexera/dsh-agent-team](https://github.com/Contexera/dsh-agent-team)
  [记忆和上下文机制](https://github.com/Contexera/dsh-agent-team/blob/master/docs/team-collaboration/memory-and-context.md)区分稳定Member与Session generation、有界索引、按需notes和轮换。
  参考机制，不默认安装整套Team UI，也不继承其可能过宽的执行权限。
- [shengsheng90/DSH-taskboard](https://github.com/shengsheng90/DSH-taskboard)
  参考SQLite任务权威、claim、版本与执行关联；不与推荐底座同时形成两份任务真相。
- [Senguk520/dsh-multitask](https://github.com/Senguk520/dsh-multitask)
  参考协调者只接简报、执行者承担细节。工具白名单可能拦住工作台工具，需要实际适配，不能安装即假设可协作。
- [Aisland-SJL/dsh-worktable](https://github.com/Aisland-SJL/dsh-worktable/blob/main/README.zh.md)
  可参考UI扩展，但项目/绑定/布局保存在localStorage、媒体保存在IndexedDB，不能直接满足本产品多设备唯一状态。
- [luanyujia-workbench](https://github.com/mashanglinyu/luanyujia-workbench)
  可参考分层记忆、交接和收据；包含自有Electron壳/片段，最小壳并非真实AI运行系统，不能当安装即用底座。

## DSH与远程边界

- [Connection](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/connection/README.zh.md)
- [Gateway](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/api/gateway/README.zh.md)
- [官方Desktop架构](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.zh.md)

远程侧详细来源在独立项目dsh-remoteconnect/docs/SOURCES.md。工作台消费版本化连接服务，认证、Peer与载体兼容由该项目承担；工作台仍要验证自己的任务和上下文链路。

## 本地旧资产

- 同级dashboard：C#/WinUI任务卡显示、依赖、排序、派发和Session引用经验；并非DSH插件。
- ArthurOS/Vault/Task_Logs：可导入的旧卡模型，路径由用户选择，真实内容不放仓库。
- ArthurOS偏好、工作流与交接格式：提炼有用字段，不整体继承所有旧治理约束。
- 已发现旧运行简报与新卡池规则不一致，旧文档不自动作为当前状态来源。

本次不修改这些旧项目、不运行旧自动化、不迁移真实卡池。

## 未验证与发布要求

当前没有实现、安装、性能或Mac实机结果。源代码参考不代表插件间兼容。复制上游代码前必须核实许可证，记录原仓库、commit、文件与修改，并保留适用的版权/NOTICE。不得用本仓库MIT覆盖其他许可。

推荐底座不通过许可/接口/存储检查时，先记录ADR和替代范围，不静默扩成从零维护一整套Agent产品。
