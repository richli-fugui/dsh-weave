# GitHub 来源安装

## 0.1.3：Windows 与 Mac（2026-10-26）

固定预编译来源：`github:richli-fugui/dsh-weave#aaa00784b6722fe8bc436d4d51e6bac5771f8cb8`。包名 dsh-table，版本 0.1.3，77 个运行文件，源码提交 c1b90e0。不要直接安装 main；本来源包含编译好的 Host/Client，不需要本机源码路径。

Mac DSH：在“插件 → 添加插件”选择“自定义地址”，粘贴上述完整来源并安装；安装完成后正常退出并重开 DSH，再从侧栏“任务台”进入。Mac 默认只作客户端，不建本地业务库，不需要改数据目录或 JSON 配置。先在 Remote Connect 0.1.19 连接 Windows；工作台顶部应显示 Windows 身份，项目和卡片应与 Windows 相同。未连接时明确显示连接缺口，不会本地开工。真实 Mac 尚未验收，若显示连接/版本错误，不要重复发同一工作，先核对 Windows 已加载 0.1.3。

Mac 继续使用自己的 DSH 模型或聊天，不会改变 Windows 工作台的数据权威。后台执行能力由 Windows 宿主提供；当前默认 Worker 的独立项目根 Session 仍待 T-002 接入，缺执行器时如实 blocked，安装不等于所有办公自动执行已完成。

本轮隔离 GitHub 安装与 rc.3 Host、真实同机 Remote Connect 扩展通路、原生 userQuestions 公共服务兼容验证已通过。Windows 原实例安装/重载的最后结果见最新 STATE；不以装包成功推断已加载。

## 0.1.1 历史安装记录

2026-10-25 审查轮：main 更新为 0.1.2 源码候选，供网页审查；codex/packages 仍固定 0.1.1，本轮未发布新安装包、未安装或重启桌面。不要用 main 代替预编译安装来源。Mac 的工作台 RemoteProvider 接线尚未实现，直接安装当前包会建立本地权威，不能据此访问 Windows 同一任务库。

工作台源码仍在 [main](https://github.com/richli-fugui/dsh-weave)，包名仍为 dsh-table。用户于2026-10-25授权将原 Windows desktop 的本地包依赖切为 GitHub 来源。

main 是源码，未提交 lib；直接装 main 缺运行入口。为避免安装时执行构建脚本，同仓库的 [codex/packages](https://github.com/richli-fugui/dsh-weave/tree/codex/packages) 仅保存经过构建、审计的安装包文件。当前0.1.1固定提交为 c6f36711a4e1833f8b9fc11fe1175bf638dccd60，PACKAGE_PROVENANCE.json 记录源码提交3150a8d与69个运行文件SHA-256；不含真实profile、数据库、日志或凭据。

官方Desktop CLI插件管理器已在隔离HOME/profile实际安装以下来源，且所有69文件比对通过；真实隔离Host的项目/控制/能力接口通过。此证据不自动代表日常实例已安装或原生桌面已加载，日常结果见 handoff/03-STATE.md。

来源：github:richli-fugui/dsh-weave#c6f36711a4e1833f8b9fc11fe1175bf638dccd60。pnpm锁定的载体是GitHub codeload固定commit tarball，不是本机file:、link:或本地仓库。安装使用随包CLI的 plugin --profile desktop add，附 --ignore-scripts；本包已编译，不需要扩大pnpm构建许可或删除原workspace设置。

后续发布保持单一安装分支，追加新的经过验证包提交，不重写已安装提交；升级时明确选择新SHA。main源码、可安装包和已运行版本分别记录。不要将安装分支合并进main源码工作树，也不要拿移动分支当已验证固定版本。

生产安装必须先取得 .dsh/.plugin-deploy-desktop.lock 的独占租约，确认活跃/排队/pending，备份清单、patch、pnpm锁/workspace、旧包和一致性工作台数据库。其他插件的来源与配置保持不变；需要撤回时只恢复工作台包，不能用旧整份profile覆盖他人后续改动。

2026-10-25日常Windows结果：已完成该固定GitHub来源安装、原生正常重开、真实Host与任务台基本界面验证；原项目/23卡/助理绑定保留，其他插件及其来源保持。详见最新STATE和轮次。
