# 给施工Agent：控制、自动维护与验证的补充交接

日期：2026-10-23。依据用户最新使用要求，补充已有施工计划。本文是待施工要求，不是完成报告。

## 先读

1. [控制与自动维护](CONTROL_AND_AUTONOMY.md)
2. [自动化验证体系](AUTOMATED_VALIDATION_PLAN.md)
3. [验证目录说明](../validation/README.md)
4. [144个场景](../validation/scenarios.json)

本次只增加规格和L0目录检查器，没有修改现有业务源码、启动DSH、安装插件或运行产品测试。

## 用户体验必须保留

- 用户只需一个稳定主入口；任务执行与上下文在后台分离。
- “继续某项目”即使未选卡，也要建立可追溯工作归属、续已有任务或登记新事项。
- 自动维护卡片与概览，不能让用户日常逐卡对账或让主助理每次全盘读项目。
- 办公、整理、研究和个人助理工作是核心场景，不只服务代码仓库。
- Windows是唯一执行和数据权威，Mac使用DSH桌面客户端。
- 主回合结束不等于后台工作结束；独立控制入口必须持续存在。

## 本次复核看到的阻塞（代码快照；施工前重读）

以下是静态观察，不是已执行的集成测试结论；若另一Agent已改动，以当前代码和真实证据复核。

| 位置 | 当前观察 | 必须补齐 |
| --- | --- | --- |
| src/client.tsx的handleSend | 普通对话setTimeout返回固定文字；消息保存在React状态 | 真实主助理Session、持久消息、事件回放 |
| src/providers/local.ts的startRun及src/index.ts | 开工主要落数据库；入口未实例化scheduler/真实worker executor | 真DSH执行与实际成果证据，受理与执行分开 |
| src/index.ts的路由注册 | 自定义any Context与get/post条件分支 | 对照目标DSH生成类型/注册方式，真实profile验证 |
| src/host/services/scheduler.ts的dispatchBatch | 忙碌项continue略过；无持久队列及完成后自动补发 | durable queue、并发与依赖解除后自动推进、恢复 |
| src/host/services/domain.ts的completeRun | worker建议可直接进入done | 按验收策略处理，主观事项待决定；所有状态变更推进revision |
| 同文件主助理状态/轮换 | 随机Session ID和generation变化 | 真Session创建/绑定/交接，pending与outbox不丢 |
| src/host/services/context.ts | 有预算字段，但未形成运行时有界上下文机制 | 实际接入、项目增量简报、来源与预算验证 |
| docs/STATUS.md、ACCEPTANCE.md与README | 对“只有方案”或“已通过”的表述互相不一致 | 依据新证据校正；mock、打包、静态检查不得充当真实DSH/Mac通过 |

不要为了消掉这些问题在文档里直接打勾。每项以实际接线和独立观测消除。

## 施工顺序

### A. 先形成最小真实DSH链路

核实目标版本/profile、公开API与插件入口。尽早在隔离profile安装测试包，让真实主助理受理一个临时办公任务 → 登记工作意图 → 启动真实worker → 在临时项目产出文件 → 回写结果。

主会话轮换时不能顺带销毁正在工作的worker。明确worker的生命周期owner：使用目标DSH支持的独立持久Session，或独立于主聊天回合的长期管理owner；不能只改数据库ID假装分离。若公开接口不支持必要生命周期，记录阻塞和替代适配方案。

### B. 实现可独立工作的Host控制

持久workIntent/Run/activation/job所有权、队列与controlEpoch。Stop直接进入Host控制服务，不排在LLM回复队列。至少支持本次工作、单项和全部工作台工作，且不波及其他DSH任务。

并行停留/创建/执行/审批/结果提交的竞态有统一规则。主Session卡住、轮换或idle时仍能发Stop。仅工具真实收敛才显示已停止；非取消工具/离线显示真实状态。先完成核心Stop，检查点暂停可延后并明确禁用。

### C. 实现验证驱动与报告

先选STOP-001/006/008/009/011/014/016/017/018/023等关键规格实现L1；同时实现真实执行、幂等、卡片验收、主Session交接及恢复用例。之后按发布能力扩充全部目录，不机械把144条中文当作已有可运行测试。

建立独立参考模型、受控工具和故障切点。保证缺driver/fixture/oracle直接失败。加入变异测试证明测试能抓住假停止、假执行和重复副作用。生成序列固定seed并能最小化重放。

每项逐层记录L1/L2/L3结果；L0的CATALOG_VALID不得计入产品通过数。未提供的Mac环境写BLOCKED。

### D. 接上远程并进入真人试用

workbench拥有工作意图、任务、控制范围及停止语义；dsh-remoteconnect提供认证、通道、重连与事件传输。控制消息需要透传commandId、host/profile、明确目标、revision/epoch及逐项结果；不能让Mac启动本地业务worker作为降级。

更新双方公开接口约定并做版本/能力协商，不另造一套任务权威。先在隔离Windows/Mac组合测试，再进入用户指定实例；按原有部署约定备份和可回滚安装，不杀日常活跃任务。

Windows小范围试用的底线是：真实对话与执行、独立停止、状态回写、恢复不重复、可回滚。不要等所有扩展完成才接真DSH，也不要把用户作为第一轮调试员。

## 交付给用户的内容

- 实际完成范围、当前源码版本/包哈希、DSH版本与profile；
- 按真实层级列出的通过/失败/未实现/阻塞，以及可定位证据；
- 如何启动、如何停止、已产生副作用和剩余限制；
- 备份与回滚位置、Mac是否真实验收；
- 用几段自然办公交互试用，用户反馈变成后续回归。
