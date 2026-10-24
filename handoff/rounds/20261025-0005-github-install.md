项目：dsh-table

# 20261025-0005-github-install：Windows工作台改为GitHub来源并真实重开加载

## 1. 身份与输入
- projectId：dsh-table，当前工作区；原Git无提交/保留未提交文件，公开源码checkout为.public-export。
- roundId/时间：20261025-0005-github-install，2026-10-25 00:05–02:33 Asia/Shanghai（含等待用户与另一插件部署）；生产改动窗口02:20–02:30。
- 工具：Codex；精确模型标识本环境不显示，不虚构。在线探针使用既有已授权openai-codex/gpt-6-luna，仅一次短回合。
- 上轮：[20261024-2310-continuity-publication](20261024-2310-continuity-publication.md)。输入源码main3150a8db00aa022361fb712919dd05dfcb3cabd2，0.1.1 tgz SHA-256 9b75a0632fc98c14569912c20af68af2772f7957538fbe4badc7118258cad755。
- 占用：owner=codex-github-install，CreateNew取得本项目.active；共享desktop租约在另一插件013轮收尾释放后才成功取得。结束只释放自有锁。
- 用户授权：将Windows DSH工作台安装来源从本机切GitHub；后明确“等Remote Connect弄完再安装”。没有给另一聊天发消息，也没有抢占其锁。

## 2. 对上一轮独立审核

| 主张/问题 | 实测与证据 | 结论/处理 |
| --- | --- | --- |
| 0.1.1候选已构建但未部署 | tgz哈希一致；生产原依赖确为本地0.1.0，实际包0.1.0 | 成立，不把公开源码当生产安装 |
| 回归105过1跳过 | 本轮typecheck退出0、106测试=105 PASS+1在线门禁SKIP | 成立，保留源码修复 |
| GitHub源码可供安装 | main未提交lib，无prepare；直接拿main不能当完整运行包 | 新发现部署缺口；提供同仓库预编译安装分支 |
| builder三轮模型等于新候选集成 | 原报告已限定经旧宿主入口；新部署不能自动继承 | 保留边界，不移算MODEL |

Windows实际官方Desktop0.2.1-rc.2，原HOME下.dsh/profiles/desktop；用户应用本体未更新。Mac版本/HOME/profile本轮未取得。

## 3. 本轮实现与理由

| 文件/模块 | 修改/理由 | 取舍与影响 |
| --- | --- | --- |
| GitHub codex/packages分支 | 仅已审计预编译0.1.1的69文件+PACKAGE_PROVENANCE.json，固定c6f36711a4e1833f8b9fc11fe1175bf638dccd60 | 避免设备构建和全局允许脚本；源码仍main，安装分支后续线性追加，不合并回源码 |
| 原desktop工作台依赖 | 随包CLI改为github:richli-fugui/dsh-weave#c6f36711a4e1833f8b9fc11fe1175bf638dccd60，--ignore-scripts | 实际GitHub archive，非本地file/link；不改其他插件来源/配置 |
| .runtime私有部署工具 | 共享租约owner守卫；原配置/包与一致SQLite备份；69文件、ID、绑定、计数、patch/workspace/bundles核验 | 临时工具不公开，无凭据读取或数据库迁移 |
| docs/GITHUB_INSTALL、README、STATE、STATUS、ACCEPTANCE、DEPLOYMENT | 记录GitHub可安装来源、真实加载、回退与未测范围 | 无业务源码/schema/依赖新增；不因安装完成关闭产品余项 |

GitHub包来源于上轮固定源码3150a8d/已审计tgz；70文件实际Git索引逐一扫描后以中立署名推送，连接器独立读回provenance。含MIT及上游版权，不含私有证据。

## 4. 验证记录

| 用例 | 层/结果 | 操作/实际证据 |
| --- | --- | --- |
| 本轮静态与回归 | STATIC/UNIT PASS | typecheck退出0，105 PASS+1 SKIP，无在线测试门禁消耗 |
| 真GitHub安装 | INSTALL PASS | 隔离DSH_HOME/profile tablegithub，随包CLI exit0；pnpm锁载体codeload固定commit；--ignore-scripts |
| 安装内容 | STATIC/INSTALL PASS | 隔离和生产69文件全部SHA-256匹配原包，profile source固定GitHub提交 |
| 隔离官方Host | HOST PASS | 官方运行时启动，临时项目根/数据完全隔离；projects/control/capabilities通过并shutdown，无模型 |
| 日常正式安装 | INSTALL PASS | 02:20取得共享租约，空闲门禁；配置及SQLite一致备份；CLI5.8秒exit0，+1/-1只换工作台0.1.0→0.1.1 |
| 安装metadata不等于新代码 | MODEL+HOST反证成立 | 一次短标记输入返回replied；原生会话当前输入没有新投影标记，证明旧进程仍执行旧路径；没有仅凭插件页v0.1.1虚报加载 |
| 正常退出/重开 | HOST PASS | 原生应用菜单“应用→退出”；没有中断警告，全部旧DSH进程正常退出，无强杀/通杀。重新启动既有应用，新进程02:28:05晚于安装 |
| 重开后业务读取与数据 | HOST PASS | 新端口重新发现54793；projects/tasks/assistant/control/diagnostics通过。1项目23卡29Run26Result110消息1assistant；原ID、绑定/generation不变，SQLite quick_check=ok |
| 原生任务台 | DESKTOP PASS（基本界面） | 新窗口实际打开任务台，23卡、控制条、主输入和历史可见；截图私有保存。不证明所有办公/审批/停止业务已验 |
| 另一插件保护 | STATIC/HOST PASS | Remote Connect0.1.18的28个lib文件逐Git blob匹配固定commit的src（其build是原样复制），来源/配置不变；重开后health ok、typert bound |
| 当前候选新多轮模型 | MODEL NOT_RUN | 限额的一次探针在重开前用于区分旧路径；重开后未追加在线消耗。原三轮builder证据不移算 |
| 真Mac/跨设备 | REMOTE NOT_RUN/BLOCKED | 无本轮Mac验证，不改产品目标 |

本机私有证据：evidence/private/github-production-20261025.json、github-native-panel-20261025.jpg、github-live-source-probe-20261025.json；隔离.runtime/github-install-20261025/report.json。测试原文/截图/DB不公开。

失败与修正：
- 创建共享锁曾遇到另一轮已重新取得租约，PowerShell未立即终止但备份工具owner守卫再次拒绝，未修改生产；后续显式ErrorActionPreference=Stop，等013轮完成再CreateNew成功。
- pnpm输出另一个Git依赖构建脚本被忽略警告，未假设安全：实际只更换工作台，额外核对远程插件28文件和health均保留。
- 最初误按远程Git的lib目录取清单，发现真实构建为src原样复制后按src→lib逐blob核对，28/28过；不是把缺Git lib误报运行缺失。
- 原生点击一度落在屏幕外，滚动后按新观测定位；scroll遗漏scrollX的参数验证失败，补0后正常。未乱点启用/卸载。
- node_repl对项目证据文件写入EPERM，计算值由正常文件工具保存；私有截图先保存自有临时目录，再复制到evidence/private，无公开图像。

## 5. 版本、备份与回滚
- 已装/已加载：dsh-table0.1.1，GitHub包commit c6f36711a4e1833f8b9fc11fe1175bf638dccd60；源码3150a8d。69文件与上轮tgz一致，tgz SHA-256 9b75a0632fc98c14569912c20af68af2772f7957538fbe4badc7118258cad755。实际GitHub archive有不同压缩/完整性，未将tgz哈希当下载archive哈希。
- 生产目标：原Windows官方desktop，安装/Host加载/原生打开分别已有证据。原配置中dataDir/model保持，实际项目目录不迁移。
- 备份：仓库外backups目录包含package、patch、lock、workspace、存在的cordis/.npmrc、旧已安装包、可CLI回退previous-install.tgz、一致SQLite、before.json。精确私有位置在.runtime/github-install-20261025/backup-location.json，不写公共绝对路径。
- 选择性回退：取得共享租约后随包CLI只add备份previous-install.tgz，再正常完整退出重开并验；不恢复整份旧profile/旧DB，保留后来产生的110条历史及其他插件改动。回退材料已验证存在，本轮实际回滚NOT_RUN。
- 工作台消息108→110是唯一一次短模型探针的输入/回复，卡/Run/Result计数未增。无用户原消息删除。
- 共享租约已在生产验证后仅由owner校验释放；项目锁在文档公开后释放。不创建定时任务、不升级DSH、不发布npm。

## 6. 开放问题与下一位具体动作

| 优先级 | ID | 下一步 | 必须取得的证据 |
| --- | --- | --- | --- |
| 最高 | T-017 | 宿主pending、晚到回复、主回合停止统一主入口与持久跟踪 | 主回合结束后仍可答问/停止，重开不丢pending，不要求切后台会话 |
| 高 | T-001/T-004 | 将原连续性验证器改为raw用户输入；原脚本自行注入builder不证明新候选产品交接 | 最多3个显式授权短模型回合，从已部署API做指代/重建验证，不由测试驱动代补上下文 |
| 高 | T-002 | 独立项目根宿主Worker | 代码/办公实际工具、权限根和客观交付，不以模型正文或文件存在代验收 |
| 中 | T-007 | 真Mac U6 | 双端同项目/卡/结果，断线、停止、重连实机 |
| 低 | T-016 | 保留已有测试卡/乱码和本轮探针 | 需用户明确清理才删除，不能“清扫”真实任务 |

下一位第一条动作：检查STATE和两个租约，typecheck/test应105过1跳过；只读确认GitHub固定依赖和69文件、原控制0。**不需要重新安装/重开来完成本轮切换**。之后先raw三轮验证，再做T-017。

相关外部事实：Remote Connect013轮重开前原有1条inbox输入在重开后不在队列，已由该项目私有找回但未重发；这不是本轮工作台安装造成，本轮不读取或重放其原文，亦不把它的恢复处理冒称本项目pending闭环。

当前无需用户再安装/重开；实际任务台已打开。主入口提问/停止联动和Mac仍有余项。

## 7. 交接自查
- [x] 独立核对旧候选、实际本地依赖与GitHub缺构建入口。
- [x] 只推进用户授权的GitHub部署，不改业务源码或接管另一项目。
- [x] 安装、Host、新原生界面、模型旧路径与Mac边界分开。
- [x] STATE/LOG/STATUS/ACCEPTANCE/README/DEPLOYMENT同步，下一动作可执行。
- [x] 原数据与配置保护，回退材料就绪；不把未演练回退写PASS。
- [x] 原始证据/截图/数据库留私有；公共材料仍经过导出/索引审计。
