# 工作台验收标准

更新：2026-10-24。本表逐项限定范围，权威摘要见 [当前状态](../handoff/03-STATE.md)。本轮 0.1.1 未部署；完整目标未降低。

| ID | 标准 | 当前状态 | 证据与剩余范围 |
| --- | --- | --- | --- |
| A01 | Mac 单主入口，不操作后台窗口 | BLOCKED | 无 Mac；原生会话提问不等同主入口可回答 |
| A02 | 绑定 Windows 原目录 | PASS（UNIT）；HOST 候选 NOT_RUN | 路径边界回归；真实权限根余项 |
| A03 | 建卡、拖卡/@、批次 | 部分验证 | 历史桌面操作摘要 5/5；0.1.1 未部署 |
| A04 | 目标/依赖/验收/稳定 ID | PASS（UNIT） | 领域回归，不代表所有人工业务验收 |
| A05 | Windows 单一权威 | IMPLEMENTED_NOT_VERIFIED | 领域权威存在；Mac 模式未实机 |
| A06 | 真实代码/办公执行与正确权限根 | IMPLEMENTED_NOT_VERIFIED | 文本 Worker 有历史模型正文；宿主 Worker/工具/沙箱仍缺 |
| A07 | 审批、问题、成果统一主入口 | IN_PROGRESS | 后台成果已有投影；宿主 pending 交互/晚到回复/主回合停止缺口 T-017 |
| A08 | Run 结束不自动 Done | PASS（UNIT）；业务验收余项 | 默认 review；关键词检查不等于内容验收 |
| A09 | 有界上下文与连续对话 | 部分验证 | 有界入口历史回归通过；新 builder 在旧宿主 3 轮 MODEL/HOST 通过，完整宿主预算与长历史检索未验 |
| A10 | 轮换不丢 pending/成果/任务 | IN_PROGRESS | 新建会话历史投影回归通过；持久 pending 及崩溃窗口未闭环 |
| A11 | unknown 与安全对账，不盲重做 | PASS（UNIT/MOCK） | 保留执行安全/对账回归；主助理错误不自动另投模型，宿主端完整故障仍需 |
| A12 | Mac 离线 Windows 继续 | BLOCKED | 无真实跨设备 |
| A13 | CAS 与代次边界 | PASS（UNIT/MOCK） | 原契约/边界反例回归保留 |
| A14 | 独立 Remote Connect | PASS（STATIC） | 不复制认证；实际双设备另外验 |
| A15 | 原 profile 安装/备份/回滚 | 历史部分；候选 NOT_RUN | 旧 0.1.0 仍运行；0.1.1 未部署，避免与另一 Agent 冲突 |
| A16 | 真 Mac 证据 | BLOCKED | 无 Mac |
| A17 | MD 只读/预览/幂等 | PASS（UNIT） | importer 回归，无真实业务迁移 |
| A18 | 公开隐私及许可 | 准备完成，上传另记 | 白名单导出、逐文件扫描、版权保留；实际 Git 索引及上传需收尾核验 |

实际验证：独立脱敏副本 npm ci --ignore-scripts --legacy-peer-deps、build、typecheck 成功；106 项 105 PASS+1 SKIP。三轮真实模型仅新 builder，经旧安装宿主入口；不等同新候选原生桌面。tarball 69 文件隐私/Host 导入/Client 懒注册与工厂解析通过，原生 Client NOT_RUN。原始证据保留本机 evidence/private，不公开。
