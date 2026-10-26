# 20261026-feedback-github-deploy：外部反馈复核、原生交互与 GitHub 安装

## 1. 身份与输入

dsh-table；工作区为用户指定本地项目目录。owner=codex-20261026-feedback-deploy；共享 desktop 租约 owner=codex-table-20261026，均 CreateNew 独占建立。输入为 main 2e9af1438b071838732e164d1567cd7209ec7351 对应源码，保留原始工作区全部未提交改动。用户明确授权修正反馈、推送可安装 GitHub 版本、安装 Windows，并说明 Mac 安装。

上轮：[20261025-194927-review-publish](20261025-194927-review-publish.md)。已按 AGENTS 和 handoff 阅读，技术选择见 ADR 0003。

## 2. 上轮与外部反馈独立审核

| 主张 | 源码与实物核对 | 结论 |
| --- | --- | --- |
| SQLite 没有 busy_timeout，建议 db.pragma | database.ts 已有 db.exec('PRAGMA busy_timeout = 5000')，node:sqlite 不是 better-sqlite3 | 不成立，保留已有正确实现 |
| 损坏依赖直接绕过执行 | scheduler 早期 every 的确宽松，但最终 domain.admitRun 内已有严格原始依赖读取，执行器不能被直接放行 | 部分成立：本轮前移严格检查并标 blocked，坏队列取消，不再仅依赖最终围栏 |
| createTask 校验在事务外 | getProject/validateDependencies 在外，成立 | 移入事务；验证读取时 db.isTransaction=true |
| unknown 没有出口 | Worker 已有 reconcileUnknownRun 和 UI 显式解除；host tracker 缺少显式放弃 | 部分成立：补 Host 放弃，不按时间假终止 |
| 移除了 bridges/bridge.ts/model.ts，export 会清构建 | 这些并非对应删除项；真实删除为 ai-client.ts，构建清理在 clean-build，不是 export | 更正审查叙述，保留已成立残留回归 |
| 原生 Interaction 应调用 interactionController | 实际安装文件已 rc.3，公开服务为 userQuestions/approval 的 scoped waterfall | 不照搬不存在的 API；按真实请求返回值实现 |

## 3. 修改与理由

- 0.1.3：建卡校验入事务；调度/队列提前拒绝原始损坏依赖，保留可读列表和最终准入围栏。
- 主助理显式放弃 unknown：精确轮次、用户确认、原因、事务审计与新绑定；不声称已验证停止。
- 原生问题/批准/拒绝在主入口呈现并结算原 waterfall；宿主请求 ID 与 tracker 统一，ACK 异常保留 unknown，并发主输入不覆盖在途回合。
- Mac 默认只转送 Remote Connect 0.1.19 的已验证连接；禁止 Mac host 模式，无本机数据库、播种、Worker 和工具注册；Windows 注册有限工作台扩展。
- 前端展示真实执行端、原生请求卡、显式放弃入口。无新增依赖，不改 Remote Connect 或 DSH 本体。

## 4. 验证

STATIC：typecheck、干净 Host/Client 构建通过。UNIT/MOCK：137/137，0 FAIL/0 SKIP；包括事务边界、坏依赖调度/队列、显式放弃、原生请求及过时回答、Mac relay 无本地库/离线/换代。

上述为控制器/网络替身，不能冒充真实宿主或 Mac。真实 HOST/DESKTOP、GitHub 安装及跨设备的实际结果在本轮收尾补记；尚未运行的项为 NOT_RUN。

## 5. 包与部署

候选 dsh-table 0.1.3，初始包 77 文件；正式安装版本以收尾固定 GitHub SHA 和文件清单为准。Windows 原 desktop 为 GitHub c6f3671 的 0.1.1；已备份配置/锁/workspace、实际旧包及一致性 SQLite，原 1 项目/23 卡/29 Runs/26 Results/116 消息/1 绑定保留。备份地址只记录于私有 .runtime/deploy-20261026/backup.json。

共享 profile 串行；仅更改本插件 GitHub 依赖，其他依赖/配置不覆盖。生产加载与回滚结果在收尾补记，不能将安装等同加载。私有原文、截图、数据库、凭据不公开。

## 6. 开放问题与下一位动作

T-002 独立项目根 Worker 仍未接入；默认无执行器会 blocked。真实 Mac 跨设备、长回合 ACK/持久命令受理与原生 continued-question 重启恢复仍需对应证据。当前轮先取得隔离 rc.3 Host/公共通路证据，再发布并用同一 GitHub 固定来源验证安装，最后原桌面串行升级和原生面板验证。第一动作以最新 STATE 收尾为准，不依赖聊天。

## 7. 自查

独立审核有反证；保留他人改动；不改他项目；用 GitHub 固定预构建包，不装本机包；真实层按实际结果分开；收尾更新 STATE/LOG/验收、补记结果并只释放自有租约。
