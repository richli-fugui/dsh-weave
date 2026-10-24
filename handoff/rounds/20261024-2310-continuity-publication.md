项目：dsh-table

# 20261024-2310-continuity-publication：入口上下文连续性、防重复派发与脱敏公开

## 1. 身份与输入
- projectId / 实际绝对根目录：dsh-table / <LOCAL_PATH>
- roundId / 开始与结束时间：20261024-2310-continuity-publication / 2026-10-24 23:10 至23:50（Asia/Shanghai）。
- Agent或工具 / 模型：Codex；本会话模型精确标识不可见，不虚构。实际测试宿主模型 openai-codex/gpt-6-luna。
- 上一轮：[20261024-2045-host-session-bridge](20261024-2045-host-session-bridge.md)。
- 输入版本：原工作区 Git main 无提交，全部 untracked，保留既有内容；不重置。输入 index.ts SHA-256 c68c90a760bb7bf8377ddfbfa695a789797bb73bd321073419c50e7abe3b0965，host-session.ts 5fcdeae2d83e1c49bec243429b4adf96bb0c91e0fa626ff9d74c043471d0c8da；包 8a809d2d63dc77e3d297878dd0eebb718117ed19a519e3411d6b237d67d346f7。
- 占用：以 CreateNew 创建 handoff/.active.json，owner=codex-continuity-publication；范围为本项目源码/测试/脚本/文档/候选包/独立公开副本。本轮没有接管他人的锁。
- 用户新增授权：上传本工作台到指定 GitHub dsh-weave，做好个人信息与凭据脱敏。该授权覆盖本次中立署名 commit、远端关联和 push，未覆盖 npm 发布或 DSH 本体升级。
- 目标：T1/T4 有界入口上下文衔接，避免宿主错误后双发；T6 可复现公开交付。

## 2. 对上一轮的独立审核

| 主张/问题 | 本轮动作和证据 | 结论 | 处理 |
| --- | --- | --- | --- |
| 候选包/源码就是报告版本 | 输入包与源码完整 SHA-256 匹配；已装 host-session.js 与输入 lib 同为 609afa35a0e4e5b1… | 成立 | 保留 |
| snapshotEvents、错误提取、复用 pin 修复有效 | 通读真实代码和 13 桥接替身；输入 typecheck 与 103 项基线通过；实时诊断 snapshotEvents 可读，MODEL/HOST 三轮 replied | 成立，含 HOST/MODEL 受限验证 | 不重写 |
| 编码损坏已修复 | 源码替换字符 0、构建/类型/回归通过；没有原作者完整源码 oracle | 现有修复成立，不宣称可证明全部原始文字逐字还原 | 保留 |
| 13/13 等于业务闭环/桌面通过 | 读取原 JSON：聊天为超时占位，Worker 为 blocked；profile/evidenceLayer 写 iso，实物端口为 desktop | 不成立的扩大解释 | 更正 STATE/ACCEPTANCE/旧轮次后注；未再运行会污染日常项目的全套脚本 |
| 主线 T-001/T-004 已闭合 | hostAssistantTurn 只传当前文字；确定性回执和后台成果只在 chat_messages；pending 在原生会话 | 部分成立，仅证明宿主回复通路 | 本轮修上下文，完整项保持开放 |
| 原生后台会话提问等于主入口提问 | 本项目 UI 没有原生 pending 回答协议；上一轮用户截图不在可独立查验材料中 | 不能推出产品通过 | T-017 最高优先级 |
| desktop 客户端历史证据 | 独立查看旧 desktop-panel PNG 与 desktop-interact summary：5/5、console 0，另有一次截图超时 | 历史版本局部成立 | 不转算到候选0.1.1 |

环境：官方 Desktop 既有发行 0.2.1-rc.2（本体 ProductVersion 0.2.1.0），资源 versions.json 声明 bundled Node 24.21.0/pnpm11.28.5；本轮构建 Node24.19.0。真实 HOME 位于用户主目录下 .dsh，profile=desktop，安装仍为 dsh-table0.1.0；本轮未导出真实 HOME。Mac 版本、来源、HOME/profile 未取得。rc.3 未安装/未运行。

## 3. 本轮实现与理由

| 文件/模块 | 修改 | 理由/取舍 | 影响与回滚 |
| --- | --- | --- | --- |
| src/host/services/context.ts | buildHostTurnInput：有界入口历史 JSON+领域状态+独立本轮输入；rotateSession 可用之前消息构建快照 | 工作台为可见入口记录，宿主为执行上下文；覆盖确定性回执/成果，避免逐条重放旧命令 | 无 schema 变化；还原两方法和集成即可 |
| src/index.ts | 讨论/普通聊天调用共同投影；宿主路径报错后不向另一模型重发；错误如实呈现 | 交接不再依赖后台聊天窗口；ACK 异常不能证明未执行 | 无额外模型通道或后台服务 |
| tests/host_continuity.test.mjs | 有界长历史、成果、当前消息一次、重建会话、两分支不重复投递，临时项目隔离 | 捕获真实调用参数及备用通道次数，属于 MOCK，不能冒充真机 | 专项2/2 |
| scripts/verify-host-continuity.mjs | 显式开关+3短回合+空闲门禁，模型结果只记录断言和会话哈希 | 用合成事实验证指代；不创建任务或写真实项目 | 通过现有旧安装入口，不证明新 index 已加载 |
| package.json / lock | 候选0.1.1；锁身份修正；包包含第三方版权 | 原 lock 仍为 @dsh/workbench，与 name 不一致；新版本避免同版重打包缓存歧义 | 旧0.1.0包保留 |
| .gitignore / scripts/export-public.mjs / audit-public-index.mjs | 独立白名单文本导出，移除文档个人路径/邮箱/真实会话 ID，拒绝已知秘密；Git索引逐文件匹配清单；拒绝未知文件/链接 | 不上传原始 evidence/截图/数据库/私有Agent记忆；不只依赖.gitignore | 原工作区不被替换成脱敏副本；独立公开checkout |
| THIRD_PARTY_NOTICES.md | 保留 Dely0 MIT 全文，固定 commit 与本地模块范围 | 连接器重新读取上游固定 commit LICENSE，不能只贴本项目 MIT | 无运行依赖 |
| README/STATUS/ACCEPTANCE/VERIFICATION/DEPLOYMENT/ARCHITECTURE/ADR/交接 | 更正旧状态及界定连续性权威 | 不用通过数量/原生后台提问冒充产品完成 | 历史轮次保留并追加更正 |

实际完成：可测试的0.1.1源码和候选包、受限真模型三轮验证、可复现脱敏发布流程。未完成：候选部署、主入口权限/晚到回复/主回合停止、宿主 Worker 与跨设备；无新增依赖/数据库迁移；宿主执行可选但缺席仅文本降级不能冒充工具执行。历史项目不受本轮修改。

## 4. 验证记录

| 用例 | 版本与层 | 操作/结果 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| 输入基线 | 旧输入 STATIC/UNIT | typecheck退出0，103=102过+1跳过 | PASS（限定） | 本轮工具输出 |
| 交接当前消息重复 | 新源码 UNIT/MOCK | 首跑新回归发现当前输入进交接快照两次；修为previousMessages再验2/2 | 修复后PASS | tests/host_continuity.test.mjs |
| 源工作区 | 0.1.1 STATIC/UNIT | build/typecheck0，106=105过+1在线门禁跳过 | PASS | 工具输出 |
| 独立脱敏副本 | 0.1.1 STATIC/UNIT | npm ci --ignore-scripts --legacy-peer-deps、build/typecheck/test均0；105过1跳过 | PASS | 工具输出 |
| 三轮活动背景/补充/刚才那个 | 新 builder + 旧已装宿主 MODEL/HOST | 显式RUN_REAL_HOST_CONTINUITY=true，61051；3次短回合；同一会话、第三轮六项断言通过 | PASS（辅助通路） | evidence/private/host-continuity-20261024.json |
| tarball | 0.1.1 PACKAGE | 69文件解包扫描/Host导入/Client懒注册及工厂解析全部过 | PASS（静态） | evidence/private/package-0.1.1.json |
| 当前候选原生桌面 | 0.1.1 DESKTOP | Computer Use选到真实DSH窗口，但访问请求超时；没有绕过访问控制 | NOT_RUN | 工具返回“Computer Use app approval timed out” |
| 当前候选真实宿主安装 | 0.1.1 HOST集成 | 远程项目占用活跃，无共享部署窗口，不安装或重启 | NOT_RUN | 相邻项目.active只读观察 |
| 真实Mac | REMOTE | 无设备 | BLOCKED | 无 |
| 公开索引/提交/推送 | PUBLIC | 93文件索引匹配、Git中立署名、push退出0与远端SHA一致 | PASS | PUBLIC_MANIFEST.json、Git远端核对 |

异常与纠正：最初系统 python 仅应用商店别名，不可用，未写入任何代码，随后用Node完成；公开扫描拒绝源码测试里类个人路径，将其改为通用 Projects 路径，扫描测试通过动态合成反例避免自报；没有用替换秘密来绕过扫描。

本轮3次在线短回合消耗既有授权gpt-6-luna额度；未另读/复制凭据。模型报告仅断言，无完整聊天。常规回归不访问在线模型。

## 5. 版本与部署
- 修改后SHA-256：index.ts 7907aace6b3662923e44c4efb59d12b41192125088cfa63c3044ce9b9c2c817f；context.ts 0dc7d66ad7eb628b3579ca33bb2b2b7cb717399f7404bff775a0475b53cf90cf；host-session.ts保留5fcdeae2…；host_continuity测试b7c7246fc87e35c4…。
- 包：dsh-table@0.1.1，.artifacts/dsh-table-0.1.1.tgz SHA-256 9b75a0632fc98c14569912c20af68af2772f7957538fbe4badc7118258cad755，从独立脱敏副本构建，含上游版权。
- 部署：NOT_RUN；未写真实profile或DB、未重启进程。另项目owner=ZCode-20261024-011在本轮观察时有活跃施工锁，未删除或抢占；未擅自发送跨聊天消息。
- 已装与已加载：0.1.0旧版；当前候选不声称加载。旧包8a809d2d…保留；本轮无数据迁移，回滚无需恢复日常数据。
- 上传仅源码，不发布npm/Release或打开网络服务。原工作区Git不含历史；独立公开checkout的中立署名、索引、远端SHA在补记核对。

## 6. 开放问题与下一位动作

| 优先级 | ID | 事实/下一步 | 完成证据 | 依赖 |
| --- | --- | --- | --- | --- |
| 最高 | T-017 | 宿主pending、晚到正文和主回合不在工作台控制域；实现持久跟踪+提问回答投影+停止联动 | 主回合HTTP结束后，主入口看到/回答宿主问题并能停止；不另开后台会话，重启无双发 | 宿主公开契约 |
| 高 | D4-0.1.1 | 取得共享部署窗口后备份并安装候选 | 安装/加载hash、真实原生Client可开、原历史/卡保留、三轮模型从候选入口通过 | 远程项目施工窗口 |
| 高 | T-001/T-004 | 已有界投影；长历史检索、pending迁移和自动轮换未闭环 | 跨轮换/重启指代和未决问题不丢 | 前两项 |
| 高 | T-002 | Worker仍主要文本桥接；接独立项目根宿主Session | 实际工具/权限根、办公/代码交付、独立验收 | 宿主适配 |
| 中 | T-007 | 跨设备未验 | 真Mac U6与停止/断线/重连 | Mac |
| 低 | T-016 | 旧验证卡/乱码保留 | 用户授权清理后才处理 | 用户决定 |

第一条可执行动作：只读核对相邻远程项目.active，不抢占；npm run build、npm run typecheck、npm test应105过1跳过。之后按STATE中的精确候选哈希与DEPLOYMENT取得共享窗口、备份、安装；检查真实Client，运行显式三轮脚本，随后做T-017。公开后续修改先重新export与索引审计，勿在原工作区git add .。

无需用户操作。Mac仅在D5且双插件已稳定时再请求。候选原生D3未重新验，不把过期菜单和旧包预览发给用户。

## 7. 交接自查
- [x] 独立审核并保留成立修复，限定证据、纠正过度结论。
- [x] 记录修改、理由、失败修复与尚未完成。
- [x] STATE更新、LOG追加、相关旧状态更正。
- [x] STATIC/MOCK/MODEL/HOST/DESKTOP/REMOTE分开，未测不算PASS。
- [x] 保留他人改动；本轮只删除自有占用。Git提交/推送获本次用户明确授权，具体结果见补记。

## 发布与结束补记（2026-10-24 23:50 Asia/Shanghai）

- 已完成用户授权的首次推送：[GitHub dsh-weave](https://github.com/richli-fugui/dsh-weave)，main源码提交 a9d745d69c2965a402c0a7d061292c25a86dabb7。git ls-remote 与本地HEAD相同；GitHub连接器独立读取远端 package.json，name=dsh-table、version=0.1.1。
- 实际Git索引93个文本文件（92白名单文件+PUBLIC_MANIFEST.json）逐一匹配SHA，秘密/用户路径扫描通过；不含evidence、截图、数据库、会话日志或Agent记忆。提交author与committer均DSH Table contributors，邮箱为项目中立noreply，未使用个人Git身份。
- 原工作区.git未关联远端/未提交；公开历史只在 .public-export/.git，后续通过export→add→audit-public-index→commit/push同步。不要将私有原工作区直接git add。
- 最终包因README纯空白收整重新打包，hash更新为9b75a0632fc98c14569912c20af68af2772f7957538fbe4badc7118258cad755；69文件重扫通过（首次重扫因Windows tar列表CRLF未剥离而失败，修正分行后通过），包README与最终公开README一致。原先中间包3eb1…不再作为候选证据。
- 全部业务与验证结论保持上述范围。三轮真实测试在日常主入口留下三组合成输入/回复，未创建验证卡，未清理原历史；T-016已补充。
- 本次补记、STATE与ACCEPTANCE将单独形成后续文档提交。最终远端HEAD以Git实时查询为准，避免文档自引用当前提交的循环。
- 结束前仅释放owner=codex-continuity-publication的自有锁；远程项目锁与真实profile未修改。
