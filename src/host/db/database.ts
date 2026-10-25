import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS, SCHEMA_VERSION } from './schema.js'

export interface DbConfig {
  dbPath?: string
  dataDir?: string
}

export function defaultDbPath(): string {
  return join(homedir(), '.dsh', 'workbench', 'workbench.db')
}

export function migrate(db: DatabaseSync): void {
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT')
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined
  const current = row === undefined ? 0 : Number(row.value)

  if (current > SCHEMA_VERSION) {
    throw new Error(`Database schema version ${current} is newer than supported ${SCHEMA_VERSION}`)
  }

  for (const m of MIGRATIONS) {
    if (m.version <= current) continue
    db.exec('BEGIN')
    try {
      m.up(db)
      db.prepare(
        "INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(String(m.version))
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
}

export function openWorkbenchDb(config: DbConfig = {}): DatabaseSync {
  const dbPath = config.dbPath ?? (config.dataDir ? join(config.dataDir, 'workbench.db') : defaultDbPath())
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true })
  }
  const db = new DatabaseSync(dbPath)
  try {
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA foreign_keys = ON')
    // 多进程场景（宿主 + 部署/验证脚本）并发写时等待锁而非立刻抛 SQLITE_BUSY
    db.exec('PRAGMA busy_timeout = 5000')
    migrate(db)
  } catch (err) {
    try {
      db.close()
    } catch {
      // ignore close failure
    }
    throw err
  }
  return db
}

export function runTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
