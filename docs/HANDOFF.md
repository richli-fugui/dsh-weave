# 给工作台施工 Agent 的交接

用户将此文件交给你并要求开工后，在本仓库实现DSH任务工作台，添加必要测试，并部署到其指定的现有Windows DSH实例。日常入口是Mac的DSH桌面软件，Windows是唯一项目运行端。

先读README、AGENTS、ARCHITECTURE、IMPLEMENTATION_PLAN、REMOTECONNECT_CONTRACT、DEPLOYMENT、VERIFICATION和ACCEPTANCE。

## 要交付的产品

一个稳定主助理对话入口 + 按项目分组的任务卡。支持从对话拆卡、拖卡/@任务、推进A/B/C；后台会话和worker由系统管理。项目关联现有文件夹，不迁移真实工作目录。

主入口只接必要摘要和证据；任务执行上下文隔离。主助理可以压缩和轮换底层Session，用户仍在同一入口继续。结果、任务和待处理问题跨轮换与重启保留。

## 先做什么

1. Gate 0核实真实DSH版本与profile。
2. 锁定Dely0工作台底座与许可证，写ADR确定唯一任务权威；不要安装多个任务库拼状态。
3. 实现LocalProvider和Windows本机闭环，再接RemoteProvider。
4. 远程连接由独立dsh-remoteconnect提供，不自行造认证/SSH/网关。
5. 双方接口仍是draft；按目标版本生成API，联调时锁定协议和能力。Remote Connect未完成时继续本机开发，远程验收保持BLOCKED。
6. 真实DSH验证执行、权限、审批、上下文轮换、幂等与结果Outbox。
7. tarball隔离安装后再部署用户原Windows实例；最后在Mac DSH实机验收。

## 可复用的旧资产

dashboard是WinUI独立看板参考，不改它。
ArthurOS任务卡可作为用户选择后的只读导入来源，不整体搬治理文档，不读凭据和无关个人库。
旧会话ID只是历史引用，不自动成为DSH会话。

## 必须交付

源码、锁文件、tarball、schema/迁移、部署与回滚工具、真实Windows部署记录、Mac实机证据、验证报告、兼容矩阵、许可说明与已知限制。

目前本仓库只有方案；尚无package.json、代码或部署工具。不得把文档示例当已实现。
未获用户授权不commit、push、创建远端仓库或发布。
结束前逐项填写ACCEPTANCE；没有Mac就明确未通过最终远程日用验收。
