import type { DatabaseSync } from 'node:sqlite'

export const SCHEMA_VERSION = 3

export interface Migration {
  version: number
  name: string
  up(db: DatabaseSync): void
}

const V1_DDL = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  root_path  TEXT NOT NULL,
  goal       TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'active',
  revision   INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

CREATE TABLE IF NOT EXISTS tasks (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id         TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  title             TEXT NOT NULL,
  goal              TEXT NOT NULL DEFAULT '',
  acceptance        TEXT NOT NULL DEFAULT '',
  status_code       TEXT NOT NULL DEFAULT 'todo',
  priority_code     TEXT NOT NULL DEFAULT 'normal',
  dependencies_json TEXT NOT NULL DEFAULT '[]',
  progress_percent  INTEGER NOT NULL DEFAULT 0,
  revision          INTEGER NOT NULL DEFAULT 1,
  extra_json        TEXT NOT NULL DEFAULT '{}',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  completed_at      TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status_code);

CREATE TABLE IF NOT EXISTS runs (
  id                TEXT PRIMARY KEY,
  task_id           TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  client_request_id TEXT NOT NULL,
  state             TEXT NOT NULL DEFAULT 'queued',
  worker_session_id TEXT,
  started_at        TEXT NOT NULL,
  finished_at       TEXT,
  outcome_json      TEXT NOT NULL DEFAULT '{}'
) STRICT;

CREATE INDEX IF NOT EXISTS idx_runs_task ON runs(task_id);
CREATE INDEX IF NOT EXISTS idx_runs_client_request ON runs(client_request_id);
CREATE INDEX IF NOT EXISTS idx_runs_state ON runs(state);

CREATE TABLE IF NOT EXISTS results (
  id                 TEXT PRIMARY KEY,
  run_id             TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  summary            TEXT NOT NULL DEFAULT '',
  artifact_refs_json TEXT NOT NULL DEFAULT '[]',
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  next_actions_json  TEXT NOT NULL DEFAULT '[]',
  review_state       TEXT NOT NULL DEFAULT 'pending',
  created_at         TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_results_run ON results(run_id);
CREATE INDEX IF NOT EXISTS idx_results_review ON results(review_state);

CREATE TABLE IF NOT EXISTS assistant_state (
  stable_id          TEXT PRIMARY KEY,
  current_session_id TEXT NOT NULL,
  generation         INTEGER NOT NULL DEFAULT 1,
  memory_index_json  TEXT NOT NULL DEFAULT '{}',
  updated_at         TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS outbox_events (
  sequence       INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id      TEXT NOT NULL,
  type           TEXT NOT NULL,
  payload_json   TEXT NOT NULL,
  delivery_state TEXT NOT NULL DEFAULT 'pending',
  created_at     TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_outbox_sequence ON outbox_events(sequence);
CREATE INDEX IF NOT EXISTS idx_outbox_delivery ON outbox_events(delivery_state);

CREATE TABLE IF NOT EXISTS task_events (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  event_code   TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  actor        TEXT NOT NULL DEFAULT 'system',
  created_at   TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id);
`

const V2_DDL = `
CREATE TABLE IF NOT EXISTS work_intents (
  id            TEXT PRIMARY KEY,
  project_id    TEXT REFERENCES projects(id) ON DELETE SET NULL,
  raw_input     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'accepted',
  control_epoch INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_work_intents_status ON work_intents(status);

ALTER TABLE runs ADD COLUMN intent_id TEXT REFERENCES work_intents(id) ON DELETE SET NULL;
ALTER TABLE runs ADD COLUMN control_epoch INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS chat_messages (
  id         TEXT PRIMARY KEY,
  sender     TEXT NOT NULL,
  text       TEXT NOT NULL,
  intent_id  TEXT REFERENCES work_intents(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at);
`

const V3_DDL = `
CREATE TABLE IF NOT EXISTS task_queue (
  id                TEXT PRIMARY KEY,
  task_id           TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  client_request_id TEXT NOT NULL,
  intent_id         TEXT REFERENCES work_intents(id) ON DELETE SET NULL,
  task_title        TEXT NOT NULL,
  project_id        TEXT NOT NULL,
  control_epoch     INTEGER NOT NULL DEFAULT 1,
  status            TEXT NOT NULL DEFAULT 'queued',
  created_at        TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_task_queue_status ON task_queue(status);
`

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial-workbench-schema',
    up(db) {
      db.exec(V1_DDL)
    },
  },
  {
    version: 2,
    name: 'work-intents-and-control-epoch',
    up(db) {
      db.exec(V2_DDL)
    },
  },
  {
    version: 3,
    name: 'persistent-task-queue',
    up(db) {
      db.exec(V3_DDL)
    },
  },
]
