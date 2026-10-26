# 工作台验收标准

2026-10-26 最新限定：0.1.3 已从 GitHub aaa0078 安装原 desktop，尚未重载（用户另派 Agent 处理订阅插件 rc.3 不兼容）。137/137 回归；隔离 rc.3 Host、已认证同机 Remote Connect 读取相同 IDs、真实 userQuestions.ask + 候选适配器结算通过。该原生服务测试用隔离辅助 tracker，不冒充完整主聊天/模型端到端。A05 的 Mac 无本地库门禁及转送代码现已接入；A07 问题/审批原请求作答有实现与上述限定证据；A15 安装/数据保留通过，重载与回滚未验；A16 真实 Mac 仍 NOT_RUN。下表保留历史，各项以本节及最新 handoff 为准。

更新：2026-10-25。本表逐项限定范围，权威摘要见 [当前状态](../handoff/03-STATE.md)。0.1.1已从GitHub安装并真实重开；完整目标未降低。

| ID | 标准 | 当前状态 | 证据与剩余范围 |
| --- | --- | --- | --- |
| A01 | Mac 单主入口，不操作后台窗口 | BLOCKED | 无 Mac；原生会话提问不等同主入口可回答 |
| A02 | 绑定 Windows 原目录 | PASS（UNIT/本机绑定读取）；权限根余项 | 路径边界回归、原绑定与ID保留；实际Worker权限根仍需A06证据 |
| A03 | 建卡、拖卡/@、批次 | 部分验证 | 历史桌面操作摘要5/5；0.1.1任务台基本打开通过，未重跑所有操作 |
| A04 | 目标/依赖/验收/稳定 ID | PASS（UNIT） | 领域回归，不代表所有人工业务验收 |
| A05 | Windows 单一权威 | 部分实现；Mac 接线缺失 | Client 仍请求本机路由，Mac Host 无禁止本地建库门禁；RemoteProvider 单独测试不能证明产品接入 |
| A06 | 真实代码/办公执行与正确权限根 | BLOCKED（默认 Worker） | 0.1.2 移除文本桥接；依赖可选 agentRunner.executeTask，真实独立项目根 Session 尚未接入 |
| A07 | 审批、问题、成果统一主入口 | 部分 UNIT/MOCK | 停止不确定性与晚到结果事务已修；原 2/5 用例创建的是另一个 tracker，只证明通用 prompt，不能证明原生交互作答。须核对公开 interactions API 再验 |
| A08 | Run 结束不自动 Done | PASS（UNIT）；业务验收余项 | 默认 review；关键词检查不等于内容验收 |
| A09 | 有界上下文与连续对话 | PASS（MODEL+HOST，raw 模式） | verify-host-continuity.mjs 改用 raw 用户输入，已部署 0.1.1 经 3 轮真实在线模型验证全部 PASS（代号/主题/格式/语气/日期/未执行） |
| A10 | 轮换不丢 pending/成果/任务 | 部分 UNIT/MOCK | 本轮修复失联/观察超时误清 pending；晚到回复与清除 pending 同事务，重启不重复投递。原生交互和完整轮换仍待验 |
| A11 | unknown 与安全对账，不盲重做 | PASS（UNIT/MOCK） | 保留执行安全/对账回归；主助理错误不自动另投模型，宿主端完整故障仍需 |
| A12 | Mac 离线 Windows 继续 | BLOCKED | 无真实跨设备 |
| A13 | CAS 与代次边界 | PASS（UNIT/MOCK） | 原契约/边界反例回归保留 |
| A14 | 独立 Remote Connect | PASS（STATIC） | 不复制认证；实际双设备另外验 |
| A15 | 原 profile 安装/备份/回滚 | PASS（本轮安装/加载/备份）；回滚未演练 | GitHub0.1.1实际安装、原生正常重开、69文件与配置/卡片/绑定保留；回退包已准备，未实际回滚 |
| A16 | 真 Mac 证据 | BLOCKED | 无 Mac |
| A17 | MD 只读/预览/幂等 | PASS（UNIT） | importer 回归，无真实业务迁移 |
| A18 | 公开隐私及许可 | PASS（公开源码范围） | 白名单导出、版权保留、上轮93文本文件及本轮安装分支70文本文件审计通过；当前维护记录按95文本文件索引审计后推送；真实数据/截图/原始证据未上传 |

实际验证：独立脱敏副本 npm ci --ignore-scripts --legacy-peer-deps、build、typecheck 成功；106 项 105 PASS+1 SKIP。三轮真实模型仅新 builder，经旧安装宿主入口；不等同新候选原生桌面。tarball 69 文件隐私/Host 导入/Client 懒注册与工厂解析通过，原生Client任务台实际打开PASS（基本界面）。原始证据保留本机 evidence/private，不公开。

2026-10-25补记：隔离与生产均真实GitHub固定commit安装；生产Host和原生基本界面通过。新候选完整多轮MODEL、原生权限集中回流、Mac仍未验，安装切换不关闭A06/A07/A09/A10/A16。私有截图与运行报告不公开。

2026-10-25 审查轮更正：以上 106 项、69 运行文件、历史 MODEL/HOST/DESKTOP 只对应旧候选。当前 0.1.2 静态与本轮隔离回归见 REVIEW_GUIDE.md；MODEL/HOST/DESKTOP/REMOTE 本轮均 NOT_RUN。源码更新和安装分支分开，不能由 push 推断已安装。A09 历史 raw 三轮主张本轮未重验；A18 以当前 PUBLIC_MANIFEST.json 和索引审计为准，旧文件数量不代表新候选。
