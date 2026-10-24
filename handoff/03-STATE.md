# 当前状态：dsh-table

更新时间：2026-10-24 23:45（Asia/Shanghai）。最近交接：[20261024-2310-continuity-publication](rounds/20261024-2310-continuity-publication.md)。
阶段：**0.1.1 源码候选通过隔离回归，尚未部署**。0.1.0 的宿主主助理回复已成立；T-001/T-004 不能整体关闭，主入口权限交互、长历史与 pending 迁移仍开放。

## 本轮独立审核与交付

- 上一轮输入源码与包哈希完全匹配；保留 snapshotEvents 读回复、模型错误提取、复用会话 pin。输入基线 103 项=102 过+1 跳过，类型检查通过。源码替换字符为 0。
- 当前官方 Windows Desktop 的宿主来自日常 desktop profile；旧安装 dsh-table@0.1.0，host-session.js 与输入构建 SHA-256 同为 609afa35a0e4e5b1…；实际监听 61051，绑定 agent idle，工作台 active/queued/awaiting/unknown 均为 0（检查时事实）。Mac 版本/HOME/profile 未取得。
- 更正：旧 13/13 是 API 断言，含超时占位及 Worker 阻塞结果，不能等同真实业务完成或新一轮桌面验收。其 JSON 将 desktop 错标为 iso。本轮未重跑会创建卡/调用 Worker 的全套脚本，避免污染日常数据及项目。
- **连续性修复**：chat_messages 是逻辑入口记录，宿主保留执行原文。每轮附加有界入口历史与当前状态，带回建卡/停止/后台成果；新建会话也走同一路径。历史 JSON ≤5000 字符，每条 ≤1000、最多 10 条，另加既有状态预算。详见 ADR 0002。
- **防重复派发**：选择宿主后发生提交/回执异常，不再静默向文本桥接重发。仅宿主能力缺席时保留文本降级。会话重建快照已排除当前输入，避免同一轮重复出现。
- **公开准备**：0.1.1 包与锁身份一致；补上游 MIT 声明；独立 .public-export checkout 只容纳白名单文本，文档去本机用户路径/邮箱/真实会话 ID，原始 evidence、截图、数据库、Agent 记忆均不上传。详见 docs/PUBLICATION.md。GitHub 上传状态将在完成后补记。

## 分层证据

| 层 | 本轮结论与边界 |
| --- | --- |
| STATIC/UNIT | 源工作区与独立脱敏副本均 build/typecheck 成功；106 项=105 PASS+1 在线模型门禁跳过。新增连续性 2 项、公开扫描 1 项 |
| PACKAGE | dsh-table@0.1.1，69 文件，解包隐私扫描、Host 导入、Client 懒注册及工厂解析 PASS；这不是原生 Client 运行证明 |
| MODEL/HOST | 新 context builder 经**已安装旧版宿主 HTTP 入口**完成 3 次 gpt-6-luna 合成对话；第三轮代号/主题/格式/语气/日期/未执行事实均正确，同一宿主会话。验证了新投影的模型可用性，不证明候选 index.ts 已加载。预算：3 个短回合，无任务/文件工具动作 |
| DESKTOP | 历史截图与 5/5 操作摘要已审核，证明历史版本界面曾打开/停止链路曾执行。本轮原生窗口自动访问请求超时，未进行新的原生操作，当前候选 NOT_RUN |
| DEPLOY | NOT_RUN。dsh-remoteconnect 本轮有活跃占用，未拿到共享 desktop 部署窗口；未安装、未重启、未改真实配置或库 |
| REMOTE/MANUAL | Mac BLOCKED，无本轮人工体验结论 |

本机证据（不上传）：evidence/private/host-continuity-20261024.json、evidence/private/package-0.1.1.json。模型证据只保存断言与会话指纹，未保存私人对话。
候选：.artifacts/dsh-table-0.1.1.tgz SHA-256 **9b75a0632fc98c14569912c20af68af2772f7957538fbe4badc7118258cad755**。
旧已装包：.artifacts/dsh-table-0.1.0.tgz SHA-256 8a809d2d63dc77e3d297878dd0eebb718117ed19a519e3411d6b237d67d346f7。两包并存，无数据迁移。

## 开放问题

| ID | 优先级 | 事实与下一步证据 |
| --- | --- | --- |
| T-017 主入口宿主控制/交互 | 最高 | 宿主原生提问仍须在后台会话操作；主助理超时后的晚到答复无持久采集；stopAll 主要覆盖 scheduler，尚未覆盖主助理宿主回合。必须实现主入口 pending 投影/作答/停止与持久跟踪，并验证主回合结束后仍可控，不用原生会话另开窗口替代 |
| T-001/T-004 | 高 | 有界入口投影已实现；候选安装后需实际 API 多轮、重建/重启及超过窗口的关键决定检索。当前 builder 真实模型通过不等同候选集成部署通过 |
| T-002 | 高 | Worker 仍主要文本桥接，主助理能用宿主不代表 Worker 已有正确权限根/工具审批；需独立项目根宿主 Session 的代码与办公交付证据 |
| D4-0.1.1 | 高 | 等共享 profile 无其他部署后备份、用 tarball 安装并验证真正加载版本与原生 Client；不抢远程项目锁 |
| T-007 | 中 | RemoteProvider 替身契约已测，Mac 实机缺席；不能将旧接口草案或 localhost 通过当 U6 完成 |
| T-016 | 低 | 历史验证卡及乱码消息保留，未擅自清理 |
| rc.3 | 低 | 允许范围已声明 >=0.2.1-rc.2 <0.3.0；rc.3 仅历史 4 文件 SOURCE_CHECKED，真实 HOST/DESKTOP/REMOTE NOT_RUN，不建议据此直接更新 |

## 下一位第一条可执行动作

先读 ../dsh-remoteconnect/handoff/.active.json（存在就不抢占），再运行 npm run build && npm run typecheck && npm test。确认共享 desktop 部署窗口、活跃任务与一致备份后，按 docs/DEPLOYMENT.md 安装上述 0.1.1 tarball；保存候选/安装 hash、实际加载版本、原生 Client 可开、原卡与历史不丢的证据。当前端口需重查，不能写死 61051。

安装后将 RUN_REAL_HOST_CONTINUITY=true 明确开启，运行 node scripts/verify-host-continuity.mjs <port> evidence/private/<unique>.json（最多三短回合），此时才可将证据提升为新候选集成 HOST/MODEL。随后优先实现 T-017；验收必须在主入口回答宿主问题并停止在途主助理，无需切换后台会话。

当前无需用户操作；不以无人值守桌面访问超时要求用户排查。下一次原生 D3 验证通过时再给最小预览步骤。
