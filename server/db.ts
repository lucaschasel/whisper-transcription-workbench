import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { listWhisperModels } from './models.ts';

export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');

// 单人工作台没有账号、会话或归属概念，schema 不再包含 users 表或 owner_id 列。
const SCHEMA = `
CREATE TABLE IF NOT EXISTS idem(
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  hash TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  PRIMARY KEY(scope,key)
);
CREATE TABLE IF NOT EXISTS assets(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  storage TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks(
  id TEXT PRIMARY KEY,
  asset_id TEXT REFERENCES assets(id),
  language TEXT NOT NULL,
  prompt TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  stage TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  token TEXT,
  child_pid INTEGER,
  error_code TEXT,
  error TEXT,
  text TEXT,
  segments TEXT,
  result_dir TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS task_created ON tasks(created_at);
CREATE TABLE IF NOT EXISTS attempts(
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id),
  number INTEGER NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS task_events(
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id),
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS llm_runs(
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id),
  action TEXT NOT NULL,
  target TEXT,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

export class Store {
  db: DatabaseSync;
  constructor(public dir: string) {
    mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(path.join(dir, 'app.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    this.migrate();
  }
  private migrate() {
    const columns = this.all('PRAGMA table_info(tasks)');
    if (columns.length === 0) {
      this.db.exec('PRAGMA foreign_keys=ON;');
      this.db.exec(SCHEMA);
      return;
    }
    if (columns.some((column) => column.name === 'owner_id')) {
      // 旧版工单 schema 残留 owner_id 归属，重建为无账号结构并保留数据。
      this.db.exec('PRAGMA foreign_keys=OFF;');
      if (!columns.some((column) => column.name === 'model')) {
        this.db.exec("ALTER TABLE tasks ADD COLUMN model TEXT NOT NULL DEFAULT ''");
        this.run("UPDATE tasks SET model=? WHERE model=''", listWhisperModels().defaultModel);
      }
      this.rebuildWithoutAccounts();
      this.db.exec('PRAGMA foreign_keys=ON;');
    } else {
      this.db.exec('PRAGMA foreign_keys=ON;');
    }
    // 幂等补齐所有表（含后续新增的 llm_runs）。
    this.db.exec(SCHEMA);
  }
  private rebuildWithoutAccounts() {
    this.tx(() => {
      this.db.exec(`
        CREATE TABLE assets_new(
          id TEXT PRIMARY KEY,name TEXT NOT NULL,storage TEXT NOT NULL,
          size INTEGER NOT NULL,created_at TEXT NOT NULL
        );
        INSERT INTO assets_new(id,name,storage,size,created_at)
          SELECT id,name,storage,size,created_at FROM assets;
        DROP TABLE assets;
        ALTER TABLE assets_new RENAME TO assets;

        CREATE TABLE tasks_new(
          id TEXT PRIMARY KEY,asset_id TEXT REFERENCES assets(id),
          language TEXT NOT NULL,prompt TEXT NOT NULL,model TEXT NOT NULL,
          status TEXT NOT NULL,stage TEXT NOT NULL,attempt INTEGER NOT NULL DEFAULT 0,
          token TEXT,child_pid INTEGER,error_code TEXT,error TEXT,text TEXT,
          segments TEXT,result_dir TEXT,metadata TEXT,
          created_at TEXT NOT NULL,updated_at TEXT NOT NULL
        );
        INSERT INTO tasks_new(
          id,asset_id,language,prompt,model,status,stage,attempt,token,child_pid,
          error_code,error,text,segments,result_dir,metadata,created_at,updated_at
        )
          SELECT
            id,asset_id,language,prompt,model,status,stage,attempt,token,child_pid,
            error_code,error,text,segments,result_dir,metadata,created_at,updated_at
          FROM tasks;
        DROP TABLE tasks;
        ALTER TABLE tasks_new RENAME TO tasks;
        CREATE INDEX task_created ON tasks(created_at);

        CREATE TABLE idem_new(
          scope TEXT NOT NULL,key TEXT NOT NULL,hash TEXT NOT NULL,
          resource_id TEXT NOT NULL,PRIMARY KEY(scope,key)
        );
        INSERT OR IGNORE INTO idem_new(scope,key,hash,resource_id)
          SELECT scope,key,hash,resource_id FROM idem;
        DROP TABLE idem;
        ALTER TABLE idem_new RENAME TO idem;

        DROP TABLE IF EXISTS users;
      `);
    });
  }
  one(sql: string, ...args: any[]): any {
    return this.db.prepare(sql).get(...args);
  }
  all(sql: string, ...args: any[]): any[] {
    return this.db.prepare(sql).all(...args);
  }
  run(sql: string, ...args: any[]) {
    return this.db.prepare(sql).run(...args);
  }
  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  taskEvent(task: string, message: string) {
    this.run('INSERT INTO task_events VALUES(?,?,?,?)', id(), task, message, now());
  }
}
