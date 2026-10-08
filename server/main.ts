import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import { Store } from './db.ts';
import { createApp } from './app.ts';
import { Transcriber } from './worker.ts';
if (existsSync('.env')) process.loadEnvFile('.env');
const mode: 'tickets' | 'transcribe' = 'transcribe';
const port = Number(process.env.PORT || process.env.TRANSCRIBE_PORT || 4320);
const dir = path.resolve(process.env.DATA_DIR || `data/${mode}`);
mkdirSync(dir, { recursive: true });
const lock = path.join(dir, 'server.lock');
if (existsSync(lock)) {
  const pid = Number(readFileSync(lock, 'utf8'));
  let alive = false;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ESRCH') alive = true;
  }
  if (alive) throw new Error(`该数据目录已有服务运行（PID ${pid}）。请使用现有服务或先停止它。`);
  unlinkSync(lock);
}
writeFileSync(lock, String(process.pid), { flag: 'wx' });
const store = new Store(dir);

const app = createApp(store);
const worker = process.env.DISABLE_WORKER !== '1' ? new Transcriber(store) : undefined;
if (worker) app.locals.workerStatus = worker.status;
app.use(express.static(path.resolve('dist')));
app.get('/{*path}', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`${mode}: http://127.0.0.1:${port}`);
  worker?.start();
});
server.once('error', (e) => {
  try {
    unlinkSync(lock);
  } catch {}
  console.error(e);
  process.exit(1);
});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await worker?.stop();
  server.close(() => {
    try {
      unlinkSync(lock);
    } catch {}
    process.exit(0);
  });
  setTimeout(() => {
    try {
      unlinkSync(lock);
    } catch {}
    process.exit(0);
  }, 2000).unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
