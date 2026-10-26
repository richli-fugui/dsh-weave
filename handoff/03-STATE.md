# 当前状态：dsh-table

更新：2026-10-26（Asia/Shanghai）。最新轮次：[20261026-feedback-github-deploy](rounds/20261026-feedback-github-deploy.md)。

**0.1.3 已从 GitHub 安装到 Windows 原 desktop，尚未重载。** 原 DSH 安装文件已是 0.2.1-rc.3，而现有 Codex 订阅插件 3.1.3 被兼容门禁拦截；用户明确交其他 Agent 升级它，本项目不动该插件、不授予版本豁免、不重启当前仍可用的进程。共享部署租约已释放，待对方完成后正常退出重开即可加载工作台，无需重装。

## 版本与保留

- 源码实现提交：c1b90e0bbdd05e1bbbbc680884d334203442da91；本轮后续文档提交不改已验证代码。
- 固定安装源：github:richli-fugui/dsh-weave#aaa00784b6722fe8bc436d4d51e6bac5771f8cb8，包名 dsh-table 0.1.3，77 文件全部匹配；不是 file/link 或本机源码安装。
- 原 1 项目、23 卡、29 Runs、26 Results、116 消息、1 助理绑定均保留；配置 patch/workspace 原字节保留。精确旧包/配置/锁/一致 SQLite 备份在私有 .runtime/deploy-20261026/backup.json 所指目录，未演练生产回滚。
- 正规 CLI 将原已声明 v0.1.19、但实际文件仍 0.1.18 的 Remote Connect 对齐到 0.1.19；声明未变，9 个文件 hash 改变，不能说其他插件字节全部未变。订阅插件仍为 3.1.3。
- 原始工作区无 Git 提交；公开历史在 .public-export；私有证据/数据库/截图/记忆未上传。保留他人未提交改动。

## 本轮实现与审核

- 外部建议中的 busy_timeout 缺失不成立；最终 admitRun 原已严格拒绝坏依赖，故“直接绕过执行”不成立，但早期调度宽松成立。
- 建卡校验移入事务；调度及队列提前严格校验坏依赖并标 blocked。
- Host unknown 增加显式放弃：准确轮次、用户确认、原因，原子审计/清 pending/换绑定，terminationVerified=false；Worker 原有手工对账保留，不按时间自动解除保护。
- 按 rc.3 公开 user-questions/request、approval/request 结算原问题/批准/拒绝；不发送普通 prompt 冒充作答。主回合请求 ID 与宿主 prompt 一致，过时请求/重复应答拒绝；ACK 异常保留 unknown，并发主输入不覆盖当前回合。
- Mac 默认只转送 Remote Connect 公共扩展，不建本地 SQLite、不播种、不注册 Worker 工具；离线/换代不回退、不自动重发写请求。界面显示执行端身份。原 RemoteProvider 是逻辑测试实现，产品实际通路见 ADR 0003。

## 分层证据

| 层 | 本轮实际结果 |
| --- | --- |
| STATIC | typecheck、干净 Host/Client 构建、77 文件打包/隐私审计通过 |
| UNIT/MOCK | 137 PASS，0 FAIL，0 SKIP |
| GITHUB_INSTALL | 隔离与原 desktop 均使用同一固定 GitHub 包，77 文件一致；原配置和数据保留 |
| HOST | 隔离官方 rc.3 启动，工作台路由与隔离根通过 |
| 协议（同机真实） | 真实 Remote Connect 0.1.19 认证连接，通过工作台扩展读出同一组项目 ID |
| 原生服务（限定） | 真实 userQuestions.ask + 候选适配器/隔离辅助 tracker 结算原 waterfall，无 prompt/模型；不等于完整主聊天/LLM端到端 |
| MODEL / 原桌面新 Client / 真实 Mac | NOT_RUN；原进程未重启，新 connection 端点尚未加载，不假称完成 |

## 下一位第一条动作

用户指定的其他 Agent 完成订阅插件兼容升级后，先重新核对/取得共享部署租约和活跃任务，正常退出重开 DSH。动态发现端口，读取 /api/workbench/connection 应为 workbenchVersion=0.1.3，再核对原生任务台、原卡/绑定及真实问题/审批从主入口解除。不可重复覆盖其他 Agent 的依赖或改回本地来源。

Mac 安装可按 docs/GITHUB_INSTALL.md 使用同一固定来源；先确保 Windows 已加载 0.1.3、Mac Remote Connect 0.1.19 已连接。真实 Mac 的相同 IDs、断线重连及停止/提问仍需实机证据。

开放：T-002 独立项目根 Worker（缺执行器仍 blocked）；原生 continued-question 跨重启恢复；长回合超过 Remote Connect 15 秒的持久受理回执/命令对账；真实原桌面/跨设备完整验收。不得把模拟文件或测试数量当业务完成。
