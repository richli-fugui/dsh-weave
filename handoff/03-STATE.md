# 当前状态：dsh-table

更新时间：2026-10-25 02:31（Asia/Shanghai）。最新轮次：[20261025-0005-github-install](rounds/20261025-0005-github-install.md)。
阶段：**Windows 日常 desktop 已从 GitHub 固定提交安装并真实重开加载0.1.1，原生任务台基本界面通过**。这关闭本轮安装来源切换，不等于完整产品/U1-U6验收。

## 当前安装与保留的数据

- 来源：github:richli-fugui/dsh-weave#c6f36711a4e1833f8b9fc11fe1175bf638dccd60；同仓库codex/packages分支，预编译包0.1.1。源码对应main3150a8db00aa022361fb712919dd05dfcb3cabd2；PACKAGE_PROVENANCE.json可定位69文件SHA-256。
- 原来源为本机0.1.0 tarball。按用户要求等待Remote Connect013轮完成并释放共享租约后，CreateNew独占安装。官方随包CLI exit0，安装时--ignore-scripts，不添加构建许可、不改实际项目目录。
- 备份：原清单、patch、pnpm锁/workspace、旧插件完整安装及回退tgz、SQLite一致性备份均已做，存仓库外私有backups。精确位置在本机 .runtime/github-install-20261025/backup-location.json。
- 安装/重开后：1项目、23卡、29Run、26Result、110聊天消息、1主助理；项目/任务ID、assistant绑定与generation保留。消息由108增至110是一次短连通性测试；没有新建验证卡。patch、workspace、bundles、其他依赖来源均未变。
- Remote Connect仍0.1.18，28运行文件与其固定commit源码映射逐Git blob匹配；重开后health=ok、官方typert通道仍bound。未改另一项目源码或其占用。

## 分层验证

| 层 | 当前结论与边界 |
| --- | --- |
| UNIT/STATIC | 本轮typecheck退出0；106项=105 PASS+1在线模型门禁SKIP；未改业务源码 |
| INSTALL（隔离+日常） | 同一个GitHub固定commit实际拉取；69运行文件全部匹配；pnpm锁载体为GitHub codeload tarball，不是file/link本机路径 |
| HOST（隔离） | 官方DSH临时HOME/profile真实启动，项目根完全隔离；projects/control/capabilities PASS，正常shutdown；无模型调用 |
| HOST（日常） | 02:28经原生应用菜单正常完整退出后重开，新进程晚于安装；项目/卡/assistant/控制/桥接诊断HTTP通过，SQLite quick_check=ok、控制active/queued/awaiting/unknown均0 |
| DESKTOP | 原生插件页显示GitHub来源和0.1.1；重开后真实任务台打开，23张卡、控制条、主输入与历史可见；不等于新候选所有交互或办公任务通过 |
| MODEL | 本轮仅一次短消息，在重开前观察到旧路径仍运行；据此没有把安装metadata误认作新代码执行。当前新候选重开后未追加模型测试。上一轮3轮仅新builder经旧安装入口，不迁移为新候选MODEL通过 |
| REMOTE/Mac | 本轮NOT_RUN，真实Mac仍BLOCKED；0.2.1-rc.3仍未实测 |

私有证据：evidence/private/github-production-20261025.json、github-native-panel-20261025.jpg、github-live-source-probe-20261025.json；隔离证据 .runtime/github-install-20261025/report.json。均不上传。

## 开放问题

| 优先级 | ID | 事实与下一步证据 |
| --- | --- | --- |
| 最高 | T-017 | 宿主pending问答/晚到回复/主回合停止仍未统一主入口。实现持久跟踪、投影与作答、停止联动；验收主回合结束后仍可控，不能要求用户操作后台会话 |
| 高 | T-001/T-004 | 有界入口投影已部署；需新候选原始chat/send用户输入的多轮、重建/重启与长历史决定检索。原verify-host-continuity.mjs会自行注入上下文，只能作builder辅助证据；下一轮先改成raw输入模式，不能让驱动替产品完成交接 |
| 高 | T-002 | Worker仍主要文本桥接，需独立项目根宿主Session、真实工具/权限与办公/代码交付证据；安装通过不关闭此项 |
| 中 | T-007 | 远程契约与本机通道不等于真Mac U6，缺设备 |
| 低 | T-016 | 历史验证卡/乱码、上一轮3组合成消息和本轮1组连通性消息均保留，未擅自清理 |
| 低 | rc.3 | engines允许>=0.2.1-rc.2 <0.3.0，真实rc.3 HOST/DESKTOP/REMOTE未验，不作兼容保证 |

## 下一位第一条动作

先读本轮记录和docs/GITHUB_INSTALL.md，检查项目/共享租约；typecheck+test应105过1跳过。不需要重新安装或再次重启来“完成”本轮来源切换。只读发现当前官方desktop进程监听后核对GitHub依赖、69文件及控制0；上次端口54793，必须重查，禁止硬编码。

之后先将连续性验证器改为直接发送原始用户输入（显式模型开关，最多3个短回合），验证已部署0.1.1，然后推进T-017。不要重跑会向日常项目批量建卡/写成果的旧verify-host-iso全套脚本。

回退：读取私有backup-location，随包CLI只把dsh-table改回备份的previous-install.tgz，再正常重开并核验；不恢复整份旧profile、不用旧数据库覆盖新消息。回退包已准备，本轮未实际回滚生产。当前无需用户安装/重开，应用已打开任务台。
