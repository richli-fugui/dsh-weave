# 任务数据字段映射与兼容规范

版本：1.0，2026-10-23
状态：Gate 0 核定

## 1. 字段映射表

| 概念 | ArthurOS 旧任务卡 (MD) | Dely0 原生 (SQLite) | DSH Table 工作台规范 (SQLite) | 兼容说明 |
| --- | --- | --- | --- | --- |
| 任务 ID | `Id` (如 `TC-0123`) | `tasks.id` (UUID / slug) | `tasks.id` (保留原 ID 或生成 stable ID) | 导入时记录 `origin='arthur_md'`, `source_id='TC-0123'` |
| 项目标识 | `Project` (项目名) | 无独立项目表，`tasks.extra` | `projects.id` + `tasks.project_id` | 映射到对应 Project 记录，无则按名字和路径创建绑定 |
| 项目路径 | `ProjectRoot` (Windows 绝对路径) | `tasks.workspace_path` | `projects.root_path` | 项目物理根目录，工作台绝对不搬移文件 |
| 标题 | `Title` (Frontmatter) | `tasks.title` | `tasks.title` | 保持一致 |
| 状态 | `Status` (Ready, Active, Done, Cancelled) | `status_code` (todo, in_progress, done, cancelled) | `tasks.status_code` | Ready→todo, Active→in_progress, Done→done, Cancelled→cancelled |
| 优先级 | `Priority` (整数 1-100) | `priority_code` (high, normal, low) | `tasks.priority_code` + `priority_num` | 保持数值与枚举双向转换 |
| 依赖阻断 | `BlockedBy` (卡片 ID 列表) | 无显式阻断数组 | `tasks.dependencies_json` (JSON Array) | 仅允许无环有效任务 ID |
| 目标 | Markdown `## Goal` 正文 | `tasks.description` | `tasks.goal` (TEXT) | 明确目标，支持小步更新 |
| 验收标准 | Markdown `## Acceptance` 正文 | 验收草稿 (`task_drafts`) | `tasks.acceptance` (TEXT) | 验收与目标分离 |
| 历史会话 | `Sessions` (字典: codex/hermes ID) | `task_sessions` | `task_sessions` | 标记历史类型（如 `role_code='legacy-codex'`），禁止作为活跃 DSH Session 续用 |
| 执行轮次 | 依赖手工追加进度段落 | 隐式会话活动 | `runs` 表 (Run 模型) | 记录每一次派发、执行会话、审批状态与结果 |
| 最终产出 | Markdown `## Output` 或链接 | `task_artifacts` 表 | `results` 表 + `task_artifacts` | 结构化存储 summary、证据文件路径与 SHA256 |
| 乐观版本 | 无 (文件修改时间戳) | 无显式 revision | `tasks.revision` (自增整数) | CAS 并发控制，防止两端修改覆盖 |

## 2. 导入与防坏原则

1. **只读导入**：旧 Markdown 文件永远只作为输入源，禁止在导入或执行中回写、修改或删除旧文件。
2. **幂等去重**：每次导入必须提供批次编号，根据 `origin` 与 `source_id` 判定是否已导入；已导入的任务不覆盖当前系统已发生的新变更。
3. **路径安全**：Windows 绝对路径在 Mac 端展示时需明确标注为远端 Windows 路径，严禁在 Mac 本地创建同名伪造路径。
4. **会话去污**：旧卡中记载的 Codex / Hermes 会话 ID 仅作为追溯历史引用，不得传入 DSH 会话恢复接口，防止抛错或会话污染。
