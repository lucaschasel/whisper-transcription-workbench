// Dry-run by default. Only orphan uploads older than 24 hours are eligible.
import { DatabaseSync } from 'node:sqlite';
import { existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve('data/transcribe');
if (!existsSync(path.join(root, 'app.sqlite'))) {
  console.log('No transcription database.');
  process.exit(0);
}
const db = new DatabaseSync(path.join(root, 'app.sqlite'));
db.exec('PRAGMA busy_timeout=5000');
const rows = db
  .prepare(
    'SELECT a.* FROM assets a WHERE NOT EXISTS (SELECT 1 FROM tasks t WHERE t.asset_id=a.id) AND a.created_at<?',
  )
  .all(new Date(Date.now() - 86400000).toISOString());
for (const row of rows) {
  const uploads = path.join(root, 'uploads');
  const target = path.resolve(uploads, row.storage);
  if (!target.startsWith(uploads + path.sep)) throw new Error('Unsafe storage path');
  console.log(process.argv.includes('--apply') ? 'Remove:' : 'Would remove:', row.id, row.name);
  if (process.argv.includes('--apply')) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const referenced = db.prepare('SELECT id FROM tasks WHERE asset_id=?').get(row.id);
      if (!referenced) {
        if (existsSync(target)) unlinkSync(target);
        db.prepare('DELETE FROM assets WHERE id=?').run(row.id);
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}
console.log(`${rows.length} orphan uploads eligible. Pass --apply to clean them.`);
db.close();
