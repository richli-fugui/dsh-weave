# DSH Table（工作台，暂名）

> 当前候选：dsh-table 0.1.1，新增有界入口上下文投影与宿主错误后防重复派发；尚未安装到日常 desktop。上一个 0.1.0 包已在 Windows 官方 DSH 0.2.1-rc.2 运行，真实跨设备未验收。
> 更新：2026-10-24（Asia/Shanghai）。项目名和公开包名以后可以调整。

## 产品目标

在DSH里提供“一个主助理对话入口 + 按项目分组的任务卡”。用户可以持续聊天、提出想法、拆解任务，也可以把卡片拖进输入栏或用@选择，再让主助理推进。后台会话、上下文轮换和执行Agent由系统管理。

Windows是唯一项目运行端；用户日常从Mac上的DSH桌面软件进入。任务、项目绑定、记忆和执行记录都由Windows持有。Mac不需要另建会话，不承担远端项目执行。

## 两个项目的分工

| 项目 | 职责 |
| --- | --- |
| dsh-table，本仓库 | 主助理、任务卡、项目关联、调度、记忆与上下文、结果汇总 |
| dsh-remoteconnect，独立仓库 | Mac DSH→Windows DSH的配对、连接、认证、流、重连和远端接口载体 |
| DSH宿主 | 模型与工具执行、Session、权限、原始日志和已有上下文压缩能力 |

本仓库不另造远程网关。远程插件未就绪时可先在Windows本机实现同一接口，再联调。最终验收必须包括实际Mac DSH；本机演示不能代替远程完成。

## 固定的产品要求

1. 一个稳定的主助理入口，底层Session可以轮换；不会为了上下文满了让用户重新找对话。
2. 多项目任务卡，项目关联Windows现有文件夹，不迁移真实项目。
3. 从对话创建/拆解任务；拖卡和@引用带稳定ID，不能只靠标题猜任务。
4. 支持“推进A”与“推进A/B/C”，显示队列、卡点、待审批和结果。
5. 执行上下文按项目和任务隔离，主对话不装入所有执行日志。
6. 任务状态、执行状态和验收分开。Agent说完成或处于idle都不等于任务验收通过。
7. 重连、重启与主会话轮换后，任务、结果和关联可恢复，不重复执行未知结果操作。
8. 普通授权任务直接推进，必要的工具权限、外发或高影响动作走DSH原审批；不把每张卡强行升级为多层评审。
9. 数据权威在Windows，Mac界面通过远程连接服务读写；不使用浏览器localStorage保存唯一任务状态。
10. 适配实际安装版本，先锁定可验证的宿主/插件组合，不承诺所有社区插件自动兼容。

## 施工入口

| 文件 | 内容 |
| --- | --- |
| [AGENTS.md](AGENTS.md) | 施工范围、授权边界、测试与完成纪律 |
| [技术方案](docs/ARCHITECTURE.md) | 界面、数据、调度、上下文与记忆 |
| [实施计划](docs/IMPLEMENTATION_PLAN.md) | 分阶段施工与检查关卡 |
| [远程接口约定](docs/REMOTECONNECT_CONTRACT.md) | 与远端控制项目对接，接口尚为设计草案 |
| [部署与迁移](docs/DEPLOYMENT.md) | 当前Windows DSH安装、只读导入旧卡、备份回滚 |
| [验证清单](docs/VERIFICATION.md) | 功能、恢复、权限、上下文和跨设备自查 |
| [验收标准](docs/ACCEPTANCE.md) | 逐项标准与结果模板 |
| [施工交接](docs/HANDOFF.md) | 给另一Agent的开工任务 |
| [参考与证据](docs/SOURCES.md) | 社区候选、旧项目边界和未验证项 |
| [当前状态](docs/STATUS.md) | 已完成与待完成 |

## 推荐底座与复用策略

优先评估并改造Dely0/dsh-personal-workbench的任务、界面和服务端存储，作为**一个**任务权威的来源。施工前锁定版本、许可证和真实接口。把单主入口、后台调度与远程连接接入进去。

Contexera等项目作为上下文和长期助理机制的参考，不默认同时安装多个任务/记忆系统。Aisland工作台的浏览器本地项目/绑定状态不能直接满足多设备要求。

当前dashboard是独立WinUI看板；它提供真实卡片样本与部分交互经验，不是DSH插件底座。本仓库不改写它的代码，不将其exe包进DSH。

## 当前能安装吗

源码可构建为 tarball。Windows 旧版已存在真实宿主/模型及历史桌面操作证据；当前候选的安装、加载与桌面验收分别记录在 [当前交接](handoff/03-STATE.md)。后台 Worker 仍主要使用文本桥接，原生审批尚未集中回主入口，Mac 实机仍缺失。不要将单次模型回复、脚本 PASS 或原生会话内提问当作整个产品完成。

开发验证（Node 24；Node 最低版本按 package.json）：

```powershell
npm ci --ignore-scripts --legacy-peer-deps
npm run build
npm run typecheck
npm test
```

常规回归不请求在线模型。真实宿主三轮测试必须显式设置 RUN_REAL_HOST_CONTINUITY=true，并使用已核对的本机端口；范围与预算见 scripts/verify-host-continuity.mjs。安装使用明确目标 profile 的官方 Desktop CLI 或插件管理器；先读 [部署规则](docs/DEPLOYMENT.md)，不要直接运行旧 deploy verify 来操作日常数据库。

## GitHub准备与暂名

本仓库独立管理。原始文档采用MIT；若改造上游代码，必须先确认并遵守其具体许可证，不能用本仓库MIT覆盖上游许可。

显示名、包名、稳定数据schema和业务ID分离。任务、项目、主助理ID不由项目名生成。私有目录、真实任务、凭据、数据库和日志不得进入Git。用户已授权将脱敏源码提交到 [dsh-weave](https://github.com/richli-fugui/dsh-weave)；未授权发布 npm。公开流程见 [隐私与上传](docs/PUBLICATION.md)。包名暂保留 dsh-table，以避免改变已安装实例身份。

## 补充：工作控制与自动验证（2026-10-23）

- [控制与主动任务维护](docs/CONTROL_AND_AUTONOMY.md)：主回合与后台工作分离、持久Stop入口、取消范围、竞态、任务卡自动更新。
- [自动化验证体系](docs/AUTOMATED_VALIDATION_PLAN.md)：状态机、故障注入、独立证据与真实DSH/桌面试用关卡。
- [验证目录](validation/README.md)：144条待施工场景、26个不变量与只读目录检查器。
- [施工补充交接](docs/VALIDATION_HANDOFF.md)：当前代码复核问题与下一步施工顺序。

这些补充文件是规格与施工要求，不代表现有业务实现已通过。
