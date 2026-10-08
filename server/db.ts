import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { listWhisperModels } from './models.ts';
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
export class Store {
  db: DatabaseSync;
  constructor(public dir: string) {
    mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(path.join(dir, 'app.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL,password TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS idem(user_id TEXT NOT NULL,scope TEXT NOT NULL,key TEXT NOT NULL,hash TEXT NOT NULL,resource_id TEXT NOT NULL,PRIMARY KEY(user_id,scope,key));
   CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,owner_id TEXT REFERENCES users(id),name TEXT NOT NULL,storage TEXT NOT NULL,size INTEGER NOT NULL,created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,owner_id TEXT REFERENCES users(id),asset_id TEXT REFERENCES assets(id),language TEXT NOT NULL,prompt TEXT NOT NULL,model TEXT NOT NULL,status TEXT NOT NULL,stage TEXT NOT NULL,attempt INTEGER NOT NULL DEFAULT 0,token TEXT,child_pid INTEGER,error_code TEXT,error TEXT,text TEXT,segments TEXT,result_dir TEXT,metadata TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS task_owner ON tasks(owner_id,created_at);
   CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,task_id TEXT REFERENCES tasks(id),number INTEGER NOT NULL,status TEXT NOT NULL,error TEXT,started_at TEXT NOT NULL,finished_at TEXT);
   CREATE TABLE IF NOT EXISTS task_events(id TEXT PRIMARY KEY,task_id TEXT REFERENCES tasks(id),message TEXT NOT NULL,created_at TEXT NOT NULL);
  `);
    const taskColumns = this.all('PRAGMA table_info(tasks)');
    if (!taskColumns.some((column) => column.name === 'model'))
      this.db.exec("ALTER TABLE tasks ADD COLUMN model TEXT NOT NULL DEFAULT ''");
    this.run("UPDATE tasks SET model=? WHERE model=''", listWhisperModels().defaultModel);
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
  personalize() {
    this.tx(() => {
      this.run(
        "INSERT OR IGNORE INTO users(id,email,name,role,password) VALUES('local','local@localhost','个人工作台','local','disabled')",
      );
      this.run("UPDATE assets SET owner_id='local' WHERE owner_id<>'local'");
      this.run("UPDATE tasks SET owner_id='local' WHERE owner_id<>'local'");
    });
  }
}
