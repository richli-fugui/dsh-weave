# ADR 0001: 确定单一任务底座与改造策略

日期：2026-10-23
状态：ACCEPTED (通过 Gate 0)
执行人：施工 Agent

## 1. 背景与环境核实

经 Windows 实机勘察，目标宿主环境如下：
- **操作系统**：Windows 11
- **Node 运行时**：v24.19.0，npm 11.17.0
- **DSH 架构**：Cordis 插件化体系（Cordis ~4.0.5）
- **目标 Profile**：`desktop`（位于 `<LOCAL_PATH>`）
- **DSH 核心版本**：`0.2.1-rc.2`（引用 `@deepseek-ai/dsh-home-paths@0.2.1-rc.2` 等）
- **宿主进程**：WorkBuddy (5.8.3) 与 DSH 桥接插件（`dsh-workbuddy-connect@0.7.9`）运行中，提供模型桥接（hy3, hy4-preview, deepseek-v4.1-flash）及 Codex 订阅
- **远程连接项目**：同级 `dsh-remoteconnect`（独立 Git 仓库，制定 `WORKBENCH_INTEGRATION.md`）

## 2. 候选底座评估与决策

按 `docs/SOURCES.md` 及施工规则，评估以下候选：
1. **Dely0/dsh-personal-workbench**（锁定 Tag: `v1.17.1`，Commit: `752eb7081514609aba2b2d6d15a916e66d8fdb36`）：
   - 许可：MIT 许可（Copyright (c) 2026 Du Penglai），与本仓库兼容。
   - 存储：采用 Node 原生内置 `node:sqlite`（DatabaseSync），WAL 模式，外键开启，无 node-gyp 原生编译依赖，在 Node 24 下零负担。
   - 架构：已有清晰的迁移机制（Schema Version 19），提供任务、草稿、事件、产出物、会话绑定。
   - 缺口：原生是日历+层级任务面板，缺少项目物理绑定、后台调度执行隔离、单主入口会话轮换、版本化 Outbox 流。
2. **Contexera/dsh-agent-team**：适合参考 Member/Generation 与轮换机制，但权限过宽，且整套 Team UI 过重，不适合作为任务数据库底层。
3. **shengsheng90/DSH-taskboard**：单纯看板，若与 Dely0 并存会造成两份可写真相。
4. **Aisland-SJL/dsh-worktable**：数据保存在浏览器 localStorage / IndexedDB，无法满足 Windows 独占权威与 Mac 远程一致性。

**决定**：
选定 **Dely0/dsh-personal-workbench** 作为**唯一的任务存储与领域底座**，在其之上进行改造和扩展。禁止引入第二份可写任务库。

## 3. 沿用、扩展与剔除边界

### 3.1 沿用
- Node 内置 `node:sqlite`（DatabaseSync）WAL 模式连接池。
- 前向数据库迁移（Migration）结构与元数据表 `meta`。
- 现存 `tasks` 基础字段、`task_events` 审计流水、`task_artifacts` 产出物存储与 `dictionaries` 字典表。
- Cordis 插件规范（`apply(ctx, config)`，`webServer` / `systemPrompt` / `tools`）。

### 3.2 领域模型扩展（工作台专有）
为满足工作台多项目、后台调度执行、审批和恢复需求，新增/扩展以下数据表与列：
1. **`projects`（项目表）**：
   - `id` (TEXT PK), `title` (TEXT), `root_path` (TEXT NOT NULL), `goal` (TEXT), `status` (TEXT), `revision` (INTEGER NOT NULL DEFAULT 1), `created_at`, `updated_at`。
   - 项目绑定 Windows 真实路径，禁止移动或重命名用户实际物理代码。
2. **`tasks` 扩展**：
   - 增加 `project_id` REFERENCES `projects(id)` ON DELETE CASCADE。
   - 增加 `goal` (TEXT), `acceptance` (TEXT), `dependencies_json` (TEXT NOT NULL DEFAULT '[]')。
   - 增加 `revision` (INTEGER NOT NULL DEFAULT 1)，用于 CAS 乐观并发冲突检测。
3. **`runs`（执行运行记录）**：
   - `id` (TEXT PK), `task_id` (TEXT REFERENCES tasks), `client_request_id` (TEXT), `state` (TEXT: queued, running, awaiting_input, completed, failed, interrupted, unknown), `worker_session_id` (TEXT), `started_at`, `finished_at`, `outcome_json` (TEXT)。
4. **`results`（执行成果与验收记录）**：
   - `id` (TEXT PK), `run_id` (TEXT REFERENCES runs), `summary` (TEXT), `artifact_refs_json` (TEXT), `evidence_refs_json` (TEXT), `next_actions_json` (TEXT), `review_state` (TEXT: pending, accepted, rejected)。
5. **`assistant_state`（主助理状态）**：
   - `stable_id` (TEXT PK), `current_session_id` (TEXT), `generation` (INTEGER NOT NULL DEFAULT 1), `memory_index_json` (TEXT), `updated_at` (TEXT)。
6. **`outbox_events`（顺序领域事件）**：
   - `sequence` (INTEGER PRIMARY KEY AUTOINCREMENT), `entity_id` (TEXT), `type` (TEXT), `payload_json` (TEXT), `delivery_state` (TEXT), `created_at` (TEXT)。
   - 提供给 LocalProvider 与 RemoteProvider 的 follow 流，支持重连追赶。

### 3.3 剔除与约束
- **不双向同步 Markdown**：旧任务卡导入仅作为只读、幂等源；原文件绝不回写、移动或删除。
- **不强行依赖外部向量数据库**：首版采用结构化索引与 TaskBrief 摘要按需读取，保证轻量可自愈。
- **不把后台 Session 暴露为强迫切换的聊天窗口**：所有执行记录由调度器管理，审批、提问与摘要统一投递到主入口。

## 4. 接口层与 Provider 约定

工作台提供统一的 `WorkbenchDomain` 领域接口：
- **`LocalProvider`**：Windows 本地直连 Domain，提供内存与 IPC 访问。
- **`RemoteProvider`**：Mac 端消费 `dsh-remoteconnect` 公开服务，调用同一套 `WorkbenchDomain` 语义端点。
- 在 RemoteConnect 未就绪时，Windows 侧 LocalProvider 即可完成端到端开发与验证。
