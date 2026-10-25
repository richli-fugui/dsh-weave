# 工作台部署、数据迁移与回滚

下文早期章节为目标流程。已有安装工具、tarball 和 GitHub 0.1.1 安装证据；实际完成范围及现行规则见本文件后续日期节和 handoff/03-STATE.md，不能从旧说明推断尚未施工。

## 1. 识别与打包

- 识别实际Windows DSH发行来源、版本、HOME、profile、当前Host与活跃任务。
- 官方Desktop、CLI和社区Desktop分别适配，不默认--profile web等于当前Desktop。
- 锁定选定工作台底座与许可证，生成完整依赖锁。
- 使用tarball安装验证，不依赖源码link。包含Host/Client产物、迁移、patch与资源。
- 先隔离profile后真实实例；不创建空实例冒充安装完成。
- 原宿主会话、Workspace、配置和其他插件不得被清空或覆盖。

## 2. 安装器目标

scripts/deploy.ps1提供Inspect、Plan、Install、Verify、Rollback、Uninstall。
Mac提供相同语义的跨平台安装/检查入口。名称可按实际工具链统一，但README与--help必须一致。

Inspect只读发现目标，不打印token或完整敏感进程参数。
Plan输出具体配置、依赖、数据库迁移、重启影响、备份和回滚。
Install重核计划指纹，备份会修改的配置/锁文件与数据库，再用目标发行版CLI安装。
Verify检查实际运行Host加载版本、Domain/schema、原会话和任务接口。
Rollback只撤销本插件变更；发现用户后来改动时不能整文件旧备份覆盖。

没有实现时不要在交付报告附“直接运行即可”的假命令。

## 3. Windows部署

在用户把施工任务交给Agent后：
1. 完成Inspect/Plan，确认当前目标和活跃任务。
2. 将备份放仓库外私有目录，不复制整个DSH凭据目录。
3. 应用本插件配置，按选定单一任务底座处理既有数据。已有同底座插件时先判定升级路径，不并存双写。
4. 无新宿主升级需求时不顺带升级DSH、模型或其他插件。
5. 安全重启确定的目标实例；不能按node.exe通杀。
6. 回读包、schema、迁移状态、主助理和任务接口。
7. 在隔离项目做一次真实任务闭环，再向用户报告。

主助理指令、模型与权限沿用当前可用配置并显式记录。不要为演示擅自切换付费模型或扩大全盘权限。

## 4. Mac与远程接入

- Mac安装工作台Client和兼容Remote Connect Client，Windows为对应Host。
- 由Remote Connect完成配对与网络；工作台只选择connectionId。
- 读取远端身份、Domain版本和能力，错误时阻塞，不回退Mac执行。
- 进入相同主助理、项目和任务。窗口内始终标明当前Windows/profile。
- 按VERIFICATION完成真正Mac桌面操作。
- 缺Mac或远程插件时报告“Windows已部署，远程待验收”。

## 5. 旧Markdown卡片导入

导入是可选迁移，默认先预览，不自动读取整个ArthurOS或所有Workspace。
用户选定卡池后：
- 只读扫描任务文件和必要元数据，不读凭据、健康库或原始私人聊天；
- 校验卡ID、依赖、项目路径、状态与旧会话类型；
- 显示新建/重复/冲突/无法映射清单；
- 确认一次导入批次，以origin/sourceId幂等写入数据库；
- 保留旧ID映射和原文件hash/时间来源；
- 不修改、移动或删除旧卡，不建立双向同步；
- 旧Codex/Hermes会话只作历史引用，不能自动当DSH Session续用；
- 导入失败可撤回该批次尚未产生新业务活动的条目；有新活动时保留并提示，不能删成果。

旧卡数量与实际项目状态会变化，测试使用脱敏fixture，不把早期统计当当前事实。

## 6. 数据备份与恢复

任务、Run、Result、Assistant绑定与Outbox必须一致备份。
SQLite采用支持WAL一致性的备份办法，不在运行中只复制主db而漏掉WAL。
schema迁移先检查兼容、可用空间和备份；失败回滚明确，不能带半迁移继续写。
恢复演练在隔离目录完成，确认业务ID、依赖、结果引用和主入口绑定可读。

原始DSH会话日志仍归DSH。工作台备份不能自称已备份全部项目与宿主。

## 7. 卸载与改名

普通卸载撤回UI、领域服务与调度监听，保留任务数据库与交付成果。
正在执行的Run先按明确策略停派发、保持现有执行或提示待处理，不能无提示杀业务任务。
恢复安装能够读取保留状态；跨schema不兼容时明确拒绝。

改名集中修改产品元信息；保留稳定schema和ID，数据路径变化用显式迁移。包名变化不是重新创建所有任务和配对的理由。

## 8. 部署证据

私有记录包含部署ID、目标profile、宿主/插件版本、tarball哈希、配置指纹、数据库备份、迁移与回滚结果。
公开报告只保留脱敏版本和测试结论。不得把真实任务库、项目路径、会话正文、连接凭据放入Git。

只安装成功、只看见页面或只HTTP200均不足以通过工作台验收。


## 2026-10-24：原生桌面部署与分阶段调试（现行执行规则）

本节是用户新增的施工要求，适用于正在施工和以后接手的Agent。旧章节中的“尚未实现/工具都是proposed”是初始设计背景；工具是否可用必须读当前源码核对。本节更新部署节奏和验收口径，不代表当前插件已修好或已通过。固定交接提示词保持原样。

### 1. 总原则与已有授权

不必等全部功能完成才接入DSH。采用“最小可加载版本 → 隔离真实宿主 → 桌面入口预览 → 小范围功能试用 → 原实例试装 → 双插件/Mac联调”循环开发，每轮都可修、构建、验证并迭代。

用户已明确允许Agent在Windows本机安装、部署、调试和验证这两个插件。完成具体计划、备份和活跃任务检查后，普通插件试装无需反复让用户批准。此授权不包含强杀活跃工作、重置真实profile、修改系统防火墙/服务、公开发布或扩大文件权限。

这里的Web Client是DSH桌面内的渲染层。它加载失败一样会让原生软件不可用；要求测试这一层，不意味着要求用户改用外部浏览器。

### 2. 当前本机依据与包身份预检

本次只读核对的实际发行版为官方Desktop 0.2.1-rc.2，安装包内的dsh、dsh-desktop-host、dsh-client-modules同版本。外部插件归真实DSH_HOME的profiles/desktop，应用本体与其app.asar不应被插件施工改写。

Windows随包CLI为安装目录下 resources/runtime/cli/bin/dsh.cmd；它使用本发行版的Electron运行时及内置pnpm，并为插件管理开放保留的desktop profile。不能用另一份全局dsh或普通Node成功导入，替代当前Desktop加载验证。

每次操作先记录：
- 实际项目绝对根目录；package.json.name必须是本插件预期名称，不能是宿主runtime/profile名称；变更名称需明确迁移。
- Host/Client导出路径、dsh.bundle.patch、dsh.client声明、版本/peer、打包文件列表；核对CLI实际参数，不猜接口。
- 实际GUI实例所用DSH_HOME/profile、进程归属、端口和数据位置。Agent沙箱内的HOME/USERPROFILE/APPDATA可能被重定向，不能只凭环境变量默认值认定是用户真实实例。
- 把启动器/包管理器的cwd、读写目标显式传入。执行后复核项目package.json和profile清单未被误覆盖；不要把Desktop runtime清单复制成插件清单。
- 新进程、监听和临时目录属于谁，是否与另一项目施工冲突；不打印含凭据的完整进程参数。

### 3. Host与Client必须分别正确构建

Host是Node/Electron后台，Client是浏览器式渲染环境。两者共享类型/协议，不共享文件句柄、凭据或Node对象。

本机dsh-client-modules的ClientModuleLoader是lazy CJS模块表：渲染层执行client bundle时应只注册window.__ModuleLoader__.load({ id, factory })，首次导入才运行factory。对应id应与启动图包名一致；bare包名与/client别名由实际加载器规则核对，不用多注册名字掩盖错误。

Client产物必须由真实打包步骤生成：不能是带顶层import/export的普通ESM源文件，也不能只把ModuleLoader包装粘在这种文件末尾。内部相对依赖应正确打入包/生成可解析chunk；共享React、Cordis等实例按目标DSH的模块表/peer规则处理。外部动态依赖也必须有实际模块图路径。

Client依赖树不得携带node:fs、node:path、node:crypto、进程创建、SSH或秘密存储实现。连接、持久凭据与系统资源放在Node侧，通过DSH已核实的公开服务/RPC/IPC访问；没有该桥接时明确未实现，不能用polyfill或关Electron安全限制假装可用。

生命周期资源用ctx.effect或该版本实际支持的dispose管理；卸载后释放自己注册的监听、定时器、UI和自有连接。关闭客户端观察不等于取消Windows业务任务。

### 4. 分阶段闸门与何时叫用户

| 阶段 | Agent先做什么 | 退出证据 | 用户何时参与 |
| --- | --- | --- | --- |
| D0 包与恢复预检 | 核对包身份、目标、旧配置/数据备份、可执行撤回路径；有启动故障先恢复 | 包/实例身份清楚，能撤回本次插件变更 | 通常不需要 |
| D1 最小加载 | build/typecheck；解包检查Host与Client；按Client脚本语义核对产物、注册和依赖 | 同一tarball可解析；不能只测Node import | 通常不需要；需要添加/运行测试时沿用项目已有授权 |
| D2 隔离真实DSH | 在独立开发HOME/profile和临时Workspace安装候选，使用实际发行版启动Host及对应桌面Client加载链路 | boot完整、Client无导入/缺模块错误、入口可打开、关闭/重开/卸载可恢复 | 最小界面出现后即可准备“预览”，不要求功能全完成 |
| D3 Windows界面预览/功能试用 | Agent先做无破坏的点击流程，说明已实现/未实现和测试数据位置；目标实例不靠已知故障硬撑 | 核心界面可打开、不拖垮宿主；预览版本已在指定实例加载 | **此时明确提醒用户打开Windows DSH**；给入口、版本、3–5个操作、预期结果和退出/回滚方式 |
| D4 原desktop实例试装 | 在已识别、无冲突的原实例应用已验证包，记录包/配置/数据前后指纹，控制一次一个插件更新 | 原会话/Workspace保留，新版本实际运行并完成小场景 | Agent先完成可自动部分；只让用户确认真实体验 |
| D5 双插件/Mac | 两插件单独稳定后合装；核对公开契约、唯一Windows权威，再做Mac | 同一项目/会话ID，停止/断线/重连等实机证据 | **到这里才请求Mac安装/配对/实机操作**；不因无Mac阻止Windows迭代 |

隔离HOME/profile不能冒充已部署原桌面；只有普通web/headless Host通过，也不能勾选真实Desktop Client通过。若当前发行版不支持隔离启动完整原生桌面，先证明隔离Host，再按D4空闲窗口做原生桌面受控预览；如实注明两层证据，不编造启动开关。

Agent应在达到D3后主动给预览，不应持续只交付测试数字，也不应把已知打不开的版本交用户发现基础故障。原实例有活跃任务时延后重启，继续独立开发；涉及中断真实任务的选择才询问用户。

预览通知模板（使用当前事实填入，未达到不要发送）：
“Windows DSH的[入口]已加载[版本/包短哈希]，可以开始[界面预览/功能试用]。请打开[指定实例]，依次[3–5步]；预期[可观察结果]。本轮只测[范围]，还未完成[限制]。数据在[临时位置]；退出方式[方法]；若启动异常，[恢复方式]。不需要另开后台Agent聊天。”

### 5. 安装、更新与HMR

开发隔离环境可按官方支持方式使用link或--patch快速迭代；最终试装和可交付证据必须回到同一份预构建tarball。通过链接源码不代表离线安装包可用，不要求先发布npm/GitHub。

安装优先使用应用内插件管理器，或这份Desktop自带CLI。核对该版本帮助后，核心语义为：
- dsh plugin --profile <目标profile> add <已构建包绝对路径.tgz>
- dsh plugin --profile <目标profile> remove <插件包名>

上面是命令语义，不是让用户直接执行的脚本。Agent应使用已识别CLI的绝对路径、显式目标HOME和参数数组，避免shell拼接；不能在项目根直接运行会把它当目标profile的包管理命令。将实际执行命令和退出码保存在私有部署记录。

CLI install/remove会维护依赖和bundle激活。不要仅复制lib或手改若干profile文件后就宣称标准安装完成。外部包的依赖、exports和Client依赖图也会变，旧进程还可能持有旧模块。

配置HMR依赖实际启用的watcher；包成员变更、版本/依赖变化、缓存的模块图更新通常需要明确重启或受支持的Client重载。没有观察到对应机制就按受控重启处理。每轮写清“已安装、待加载、已加载哪一版”。

不对真实desktop使用--from-default-profile：该选项会替换目标profile；不是普通启动或安全重试按钮。--dump-config及其变体也可能初始化/写补丁、导入代码或输出敏感值，不能当作绝对只读检查。

### 6. 安全试装和双项目协调

1. 先确定安装目标/候选哈希及另一个Agent是否操作同一desktop。两个项目各自的.active.json只锁项目，不能替代共享profile安装锁。
2. 部署窗口需对同一HOME/profile独占协调；可用仓库外私有运行目录的独占CreateNew/wx租约，或Desktop本身的事务锁，加明确目标与owner。不自动删除他人的锁。
3. 备份将改变的依赖/激活清单、profile patch和锁文件；必要数据库用一致性备份，不能只拷运行中的WAL主文件。备份放仓库外，原用户数据不能拿来做故障注入。
4. 识别活跃任务、排队输入、待审批及当前Host。一个数据集仅一个写Host；临时验证Host不要复用生产会话库、工作台DB、配对状态或监听端口。
5. 先安装/验证单个插件，再合装。一次只更新一个候选；不让两个Agent同时热覆盖、同时重启或把失败归给另一插件。
6. Agent可在现有授权内启动/正常关闭精确目标；不通杀node/electron、不杀端口占用进程。工具由Agent拉起，不意味着它拥有其他日常进程。
7. 验证出现错误立即停止推广该候选，记录并撤回本插件改动，不能在用户日常实例反复崩溃试错。因未知副作用被保护的任务不得为复测清空或改成todo。

### 7. 这次启动弹窗的处理规则

“web boot: 1 entry did not activate / dsh-remoteconnect: import failed”是插件Client启动失败，不是普通模型拒绝。当前已定位的2026-10-24T06:55:54.399Z报告进一步包含：
“Uncaught SyntaxError: Cannot use import statement outside a module”。
这证明当时加载的客户端脚本格式有问题；没有证据说明任务数据因此损坏，也不能保证后台工作已经停止。

先保存诊断路径、候选/安装包哈希及脱敏错误。原始crash日志可能包含私人路径/配置，留本机，不整份写入仓库或贴公共issue。分别确认Host进程、实际任务、客户端启动情况。

恢复优先级：
- 能使用共享插件管理器/CLI时，优先仅撤回或停用有问题的插件/Client激活，保留其他配置；核对真实版本支持的动作。
- 若整个桌面无法启动，可使用原生“禁用第三方插件、备份 profile patch 并重启”救援。Agent先解释它是较宽的恢复：本机实现会把profile patch改名备份，并把bundle激活恢复到内置集合；会影响工作台、远程插件以及其他扩展的启用状态，不只坏掉的一个插件。
- 救援保留已安装包、以前的补丁备份与任务/Workspace数据；home级patch不会被此操作改掉。如果故障来自home补丁，还要继续定位。不能把救援说成“完全不改变配置”。
- 恢复后先确认原宿主能打开，再选择性恢复所需配置和修好的单个插件。不能把导致故障的整份patch盲目恢复，形成启动循环。
- 没有应用本体损坏证据，不优先重装整个DSH，更不能删DSH_HOME、重建空profile或清除会话库来解决插件导入错误。

### 8. 每轮部署记录与验收

至少记录候选源码/包/解包/实际安装/运行时Client版本；目标发行版与profile；确切更新范围；是否重启与活跃任务处理；备份/选择性回滚；Host日志、Client控制台及实际界面步骤；未执行的层。

统一分开：installed / host_loaded / client_loaded / desktop_opened / windows_smoke / mac_e2e。仅有listener、HTTP200、Node require、mockCtx、文件同步或“VERIFIED_OFFLINE”均不足以说明用户可以开始用桌面。

本次只更新施工文档；未实际部署或修复插件，不继承其他Agent报告的PASS。当前施工Agent应把本节发现的问题吸收到其本轮STATE/记录；不让用户重新搬运聊天。

### 9. 依据与版本限制

研究日期2026-10-24。优先依据本机0.2.1-rc.2的app.asar源码：lib/main.js中的DesktopProjectManager.disableAllPlugins/sanitizeProfile、dsh-desktop-host/lib/cli.js、dsh-client-modules/lib/client.js和lib/index.js，以及本次指定crash报告。只读研究没有修改app.asar。

官方资料用于对照；master会变化，施工时以目标发行版声明/源码为准：
- [插件安装与bundle/profile区分](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish)
- [CLI、配置层与重启边界](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md)
- [Client模块表与构建契约](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/modules/README.md)
- [官方Desktop插件管理与原生恢复](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md)

### 10. dsh-table本轮必须吸收的具体事项

**包身份是当前阻塞项，不能跳过。** 2026-10-24只读检查时，项目根package.json.name为@deepseek-ai/dsh-desktop-runtime、version为0.2.1-rc.2，且scripts不存在；文件修改时间为当日14:52:39。这与本项目dsh-table身份不符。只确认观测，不推断是谁/哪条命令导致。

施工Agent应立即核对当前清单、已有tarball和可定位的最后正确版本，判断是否被临时调试流程误写。修复本项目清单时选择性保留有效依赖/改动；不要从runtime或profile再拷一整份。根清单、导出、构建脚本、依赖锁和候选包重新一致前，不运行安装/发布，也不把旧包的通过结果转算到当前源码。如果已经由施工者修好，以新证据关闭，不机械重做。

现有scripts/deploy.ps1入口是Action转发；安装/回滚能力须核对当前后端是否真实实现。不要因为旧文档列了Install/Verify/Rollback，就把未实现动作交用户执行；没有安全安装器时先补齐或用已核实的Desktop插件管理入口。

隔离profile不会自动隔离工作台的全局默认数据库。开发运行必须显式指定临时dbPath/dataDir与临时项目根，核实没有落到用户日常.workbench数据或现有项目；不更改真实项目绑定，不迁移真实卡片。相同数据不要同时由临时Host和生产Host写入。

首轮Windows预览可以只开放：单主入口、示例项目/卡片、材料编辑和控制条；未接通真实worker/审批/远程时明确显示状态，不用假成功。Agent先确认真实可达入口，再给3–5步预览操作；不要求用户先建后台聊天，也不承诺未验证的菜单/按钮。

功能试用至少包含一段办公材料的多轮修改、后台运行时继续聊天、停止A且B不受影响、成果与卡片状态对应。unknown核验按钮存在不证明真实worker对账已接通，需单独取HOST证据。远程插件自身恢复稳定之前，本机工作台可以独立推进；整体验收仍保留Mac链路。



## 2026-10-24：DSH升级兼容与低维护策略

本节回应用户“尽量正常更新DSH，插件不要每次重做”的要求。固定交接提示词不变。这里是研究结论与后续施工要求，**不是已经实现的自动升级/兼容保证**；本次未点击更新、安装新宿主或运行rc.3实机测试。

### A. 目标与现实边界

目标是同一插件包覆盖一段经过设计/验证的DSH版本，普通小更新通常无需改代码；确有接口变化时集中修改薄适配层。不要将长期冻结DSH、每个RC复制一个完整插件分支、让用户反复重装和丢数据当成默认维护方式。

DSH仍有预发布版本，0.x/rc编号不保证接口稳定。永久免维护不可承诺，但可以减少耦合并提前检出大部分破坏。用户不承担例行排查，Agent完成版本核对与隔离自查后再给清楚结论。

### B. 社区已有的经验与取舍

| 参考 | 已有做法/实际问题 | 本项目采用什么 |
| --- | --- | --- |
| dennisrongo/dsh-plugins | 作者记录过codec从schema到create()的变化，并以同一个descriptor兼容两个时代；也分别记录实际测过的CLI/社区Desktop版本 | 将差异封装在一个小适配器中，验证旧/新两边。该仓库讨论的社区Desktop不等于用户的官方Desktop，不照搬其generation路径 |
| wenzetan/dsh-llm-newapi | 有宿主导出面快照/test:host及支持版本表；当前README明确已归档 | 借鉴接口契约检查，不将归档项目当成持续维护的运行依赖；不照搬每个RC另发一条插件线 |
| Scorp1o117/dsh-plugin-marketplace | 明确engines.dsh/peer范围，并列出不同release的compatible/unknown/incompatible | 分开“允许版本范围”和“实际验证状态”，不以一个大通配符假装已测全部 |
| Xrainsmile/DSH-Plugin-Doctor | 临时HOME试装、宿主启动、兼容矩阵与可恢复安装 | 借鉴隔离验证/报告结构；不默默新增常驻服务或安装Doctor为必需依赖。静态扫描与普通Web启动也不等于原生Desktop通过 |
| 官方Discussion #8032、#10299 | 用户报告过UI图标变化、版本范围/失效link、升级文件占用及插件管理更新语义改变 | 更新后验证实际UI和包管理行为；不能把社区个例当所有版本现状，具体操作按目标版本公开契约 |

这些是作者/用户的一手说明，不是官方兼容认证。参考项目许可证与代码来源需在实际复用前核对；本次没有复制其实现。

### C. 当前截图中的rc.3：已查到什么

官方tag dsh-v0.2.1-rc.3已发布，发布说明列出入口“更多”菜单、未发送草稿恢复及API Key模型目录更新。仅凭发布说明不能宣称无破坏。

本次用GitHub连接器分别读取rc.2、rc.3的以下文件，内容/Blob SHA相同：

| 文件 | 两个tag相同的Blob SHA |
| --- | --- |
| packages/boot/app-boot/src/plugin-compatibility.ts | 2e4ca5736a775aceadb0a2a10140af61f94ed2ac |
| packages/client/modules/src/client/manifest.ts | 1926d812a19f26f122d604559f7412222672766f |
| packages/api/session-controller/src/index.ts | 2362bce21c169a4825850c58a9c259b8fbc5e884 |
| packages/client/ui-slots/src/index.ts | 85c7d676cccc53c0958182eea8f98dd2bae9042a |

这支持“上述接口的改造风险较低”的推断，不是全依赖/生成schema/二进制/实际行为兼容证明。compare API本次返回300个文件，可能已达文件列表上限，不能用它宣称全仓没有其他变化；一个未找到的typert.ts路径也没有算入通过。新增“更多”菜单仍可能改变入口可见位置，必须实际打开侧栏验证，不能将图标被折叠误判为插件未加载。

当前rc.3状态：SOURCE_CHECKED，仅上述4文件；HOST/DESKTOP/REMOTE均NOT_RUN。截图“已准备就绪”也不证明已安装/已运行该版本。不要凭本节更新实际验收为PASS。

### D. 官方版本门禁：正确使用但不冒充兼容

本次核对到rc.3标签下的evaluatePluginCompatibility：
- 有engines.dsh时优先按它判定；没有时才检查@deepseek-ai/dsh及@deepseek-ai/dsh-* peer。
- 这两个版本的DSH判定使用semver.satisfies(..., { includePrerelease: true })。普通包管理器/其他工具不一定同样对待预发布，必须分别核对，不能照搬网上某个范围就宣称rc已覆盖。
- 没有不满足的声明，不等于业务/Client已测过。只声明Node、Cordis、Schemastery、React范围也不能表达DSH支持范围。

本次读到两个项目根清单都尚无engines.dsh。施工Agent应按真实依赖补合理的有上下界范围，并与peer和安装工具一致；不要简单改成*、删除门禁或添加未经验证的“全版本兼容”。

用户希望降低摩擦，因此不要默认精确锁死一个RC：能力/契约允许时覆盖同一兼容版本线，新小版本在允许范围内先做自动检查与隔离冒烟，检查通过无需为版本号重复改业务代码。范围上限、最低版本及预发布处理须有理由；允许范围内尚未实测的版本仍标UNVERIFIED，不能自动写VERIFIED。新minor或越界版本优先做适配评估，不能靠版本例外绕过。

不自动执行allow-version/accept-risk，不为摆脱警告伪造版本。这类精确版本例外需用户明示同意，且不修复真正的接口破坏。

### E. 代码结构与失败边界

1. 任务、记忆、队列、Run/Result、连接协议和本地业务ID保持自身领域模型；DSH接口变化不应传播到全部业务文件。
2. 用一个明确的Host适配层封装真实Session、工具、权限与事件；用一个Client适配层封装公开slots、RPC/模块表与共享组件。兼容分支只放这里，不在各模块散布猜版本的if。
3. 优先公开exports、声明/生成schema和公开服务。不要解析app.asar里的私有文件名、硬编码内部哈希、改宿主源码/私有store、定位DOM私有class来实现日常功能。研究时读源码不等于产品运行时可依赖私有路径。
4. 能力探测同时核对方法、请求/返回结构及必要语义；typeof方法存在不能证明参数/取消/幂等含义相同。确需新旧两形态时分别经过旧/新宿主验证。
5. 非必要图标、可选美化或新增菜单能力缺失，应有轻量替代/隐藏该项；不让一个图标名拖垮整个桌面。模型执行、权限、任务停止、业务写入等关键能力缺失必须阻断对应动作、如实说明，禁止静默扩大权限或假成功。
6. 包/Client入口保持可解析且最小，所有业务副作用延迟到受管生命周期；注意顶层语法/导入错误发生在apply之前，单靠try/catch不能保证自救。构建与真实Client启动检查仍必需。
7. 新DSH不支持时，尽量仅让本插件受影响功能不可用、保留历史和诊断；选择性撤回本插件，不使用户清空整个profile。不要承诺插件能捕获所有宿主级启动故障。

### F. 最小升级验证矩阵：少而关键

维持“当前已知可用版本 + 计划升级版本”两条主线，不建覆盖所有历史版本的重型平台。对同一插件候选包分别记录：

- 精确DSH发行版/版本、平台、实际Node/Electron、包哈希、配置和数据schema版本；先区分官方Desktop、社区Desktop和CLI，不混用它们的版本号。
- 安装声明/公开导出/请求返回契约检查，区分声明门禁通过与真实功能。
- 隔离真实Host加载及基本只读查询；在受控样例中验证写入、幂等、停止、资源释放与故障恢复。
- 实际Client产物加载、侧栏入口可见/可打开、共享React/Cordis模块单例；不能只用Node require证明。
- 两插件分别通过再合装；需要时才用明确预算做真实模型调用。常规兼容检查不应读私人凭据或消耗在线模型。
- 真实Mac另列维度，缺设备如实BLOCKED；不因为没有Mac停止Windows兼容自查。

状态至少区分DECLARED、SOURCE_CHECKED、CONTRACT_PASS、HOST_PASS、DESKTOP_PASS、REMOTE_PASS、UNVERIFIED、INCOMPATIBLE。报告精确范围；不能将“新版本没列breaking changes”或“测试脚本仍绿”折算为所有层PASS。

施工Agent可把这套检查接到现有构建/回归与未来仓库CI，输出小份脱敏矩阵。优先复用已有脚本，依赖/声明/接口清单变化才刷新契约快照，不重建第三套测试框架。本次尚未创建CI或定时监控，也没有自动更新权限。

### G. 用户更新的实际体验

目标流程：
收到DSH新版本 → Agent核对目标release与插件依赖 → 隔离检查同一候选包 → 给“可更新/有具体限制/已知不兼容”结论 → 原实例安全更新 → 重启后核对实际版本和短冒烟。

自动检查通过时，不要求用户重新建项目、建会话、重配任务卡或手工找兼容分支。需要人时只给一次明确更新/预览操作。用户已经允许Windows插件开发部署，但DSH应用本体更新、尤其截图安装按钮，不因此由Agent擅自点击。

用户已先更新时：先只读识别运行版本与能力。符合已声明/已验证能力就继续；不明状态先保留数据并隔离核验。确有失败优先修适配器或选择性停用本插件，不能静默让Mac改本地执行，也不能重发结果未知的工作。

插件更新与DSH更新分开推进，一次只改一个可定位边界。保留精确已知可用安装物及配置；插件自己的数据schema可迁移且有一致性备份。DSH原生会话若已被新版本迁移，不能假设降级旧程序即可读取，更不能用旧数据库覆盖升级后新产生的任务/成果。

### H. 资料入口与适用限制

以下是本次实际读取的原始资料；链接master/社区README可能继续变化，实际施工应记录所用commit/tag，不照抄过时安装命令。
- [rc.3官方发布](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.3)
- [rc.3固定标签的兼容判定源码](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/packages/boot/app-boot/src/plugin-compatibility.ts)
- [dennisrongo：跨版本codec适配与验证记录](https://github.com/dennisrongo/dsh-plugins)
- [NewAPI：导出面快照与版本表；项目已归档](https://github.com/wenzetan/dsh-llm-newapi)
- [市场插件：范围声明与验证矩阵](https://github.com/Scorp1o117/dsh-plugin-marketplace/blob/main/package.json)
- [Plugin Doctor：隔离检查思路，非本项目必需运行依赖](https://github.com/Xrainsmile/DSH-Plugin-Doctor)
- [社区实际升级故障反馈 #8032](https://github.com/deepseek-ai/deepseek-harness/discussions/8032)
- [安装与更新语义讨论 #10299](https://github.com/deepseek-ai/deepseek-harness/discussions/10299)

### I. dsh-table具体落点

- 当前根清单已读到name=dsh-table、version=0.1.0；上一节部署研究中错误runtime清单是此前观测，不能继续当成未修复的事实。未因此宣称宿主加载或完整功能通过。
- 将ctx.webServer/systemPrompt/tools、可选真实worker接口、Client slots/共享组件适配集中化。当前宽泛any和方法存在判断不是长期稳定契约；不要把测试mockCtx当公开DSH接口证明。
- 任务与Run/Result及SQLite是工作台自身领域；底层DSH版本改变不应重建assistant stableId、project/task ID或卡片。自有schema迁移和DSH会话迁移分别备份/验证。
- 升级关键样例：同一主入口保留原历史；原卡能继续；后台运行时主回合可结束；只停A不影响B；pending提问/结果与会话轮换仍关联；重启unknown不盲重做。
- 偏好自己的轻量UI外壳和公开slot，不耦合宿主内部DOM或易改的图标词表。缺少可选图标不应让办公/卡片界面崩溃。
- rc.3新增“更多”菜单后，核对卡片工作台入口是可见/可从更多菜单找到，不改注册ID来绕过用户隐藏偏好。


## 2026-10-24 23:45 本轮状态更正

根清单已恢复并验证为 dsh-table@0.1.1，包锁身份一致，engines.dsh 已声明 >=0.2.1-rc.2 <0.3.0。旧“包身份当前阻塞”与“未声明 engines”的观测保留历史，当前不再成立；rc.3 真实验证仍未完成。本候选未部署：远程项目有活跃施工，本轮没有共享 desktop 部署窗口，未改配置、未重启。下一位先按 handoff/03-STATE.md 获取窗口与备份，不把候选静态/模型辅助验证当安装完成。

## 2026-10-25：Windows已切GitHub0.1.1

来源固定为github:richli-fugui/dsh-weave#c6f36711a4e1833f8b9fc11fe1175bf638dccd60，预编译安装分支codex/packages，详见GITHUB_INSTALL.md。随包CLI支持GitHub spec，实际载体为固定commit codeload tarball；隔离安装/Host先通过，再等另一插件013轮完整完成后串行安装。--ignore-scripts不需要新增构建许可；保留原pnpm-workspace和其他GitHub依赖。

原profile及一致SQLite备份已做。69文件比对、原23卡和绑定、配置/其他依赖保留。原生插件页显示0.1.1仍不能单独证明新代码加载：本轮一条短消息证实旧进程仍执行旧路径，所以通过应用菜单“应用→退出”正常完整退出，再由原应用入口重开。不同于只关窗口，已独立核对旧后台全部退出、新进程晚于安装。退出时没有警告弹窗，无通杀/强杀操作。新Host与原生任务台基本界面均通过；当前新候选MODEL业务和Mac不因此通过。

精确私有备份位置见.runtime/github-install-20261025/backup-location.json。选择性撤回只装该目录previous-install.tgz，不覆盖整个profile或恢复旧DB。备份存在/可检查，真实生产回滚NOT_RUN。
