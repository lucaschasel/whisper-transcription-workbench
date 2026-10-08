import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { Store, id } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { createServer, type Server } from 'node:http';

const resources: { root: string; store: Store; server: Server }[] = [];
const previousModel = process.env.WHISPER_MODEL;
const testModelRoot = mkdtempSync(path.join(os.tmpdir(), 'personal-models-'));
process.env.WHISPER_MODEL = path.join(testModelRoot, 'large-v3-turbo.pt');
writeFileSync(process.env.WHISPER_MODEL, 'test model');
writeFileSync(path.join(testModelRoot, 'small.pt'), 'another test model');

async function setup() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'personal-audio-'));
  const store = new Store(root);
  const app = createApp(store);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  resources.push({ root, store, server });
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const req = (route: string, method = 'GET', body?: any, key?: string) =>
    fetch(base + '/api' + route, {
      method,
      headers: {
        'X-App-Request': '1',
        ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    });
  return { root, store, base, req };
}

after(async () => {
  for (const { root, store, server } of resources) {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    store.db.close();
    assert.ok(
      path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + 'personal-audio-'),
    );
    rmSync(root, { recursive: true, force: true });
  }
  rmSync(testModelRoot, { recursive: true, force: true });
  if (previousModel === undefined) delete process.env.WHISPER_MODEL;
  else process.env.WHISPER_MODEL = previousModel;
  delete process.env.LLM_BASE_URL;
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_MODEL;
});

test('Personal workspace has no account surface and exposes no auth routes', async () => {
  const s = await setup();
  const meta = await s.req('/meta');
  const metaBody = await meta.json();
  assert.equal(metaBody.personal, true);
  assert.equal(metaBody.maxUploadMB, 1024);
  assert.equal(metaBody.defaultModel, 'large-v3-turbo.pt');
  assert.deepEqual(
    metaBody.models.map((model: any) => model.id),
    ['large-v3-turbo.pt', 'small.pt'],
  );
  const list = await s.req('/tasks');
  assert.equal(list.status, 200);
  assert.equal(list.headers.get('set-cookie'), null);
  assert.equal((await s.req('/auth/login', 'POST', {})).status, 404);
  assert.equal((await s.req('/auth/me')).status, 404);
});

test('Mutation requests still reject foreign-origin and unmarked calls', async () => {
  const s = await setup();
  assert.equal((await fetch(s.base + '/api/tasks', { method: 'POST' })).status, 403);
  assert.equal(
    (
      await fetch(s.base + '/api/tasks', {
        method: 'POST',
        headers: { 'X-App-Request': '1', origin: 'https://untrusted.example' },
      })
    ).status,
    403,
  );
});

test('MP3 upload, idempotent creation, range preview and cancel/retry work without cookies', async () => {
  const s = await setup();
  const form = new FormData();
  form.append(
    'file',
    new Blob([Buffer.from('ID3test-audio-content')], { type: 'audio/mpeg' }),
    '中文录音.MP3',
  );
  const upload = await s.req('/assets', 'POST', form);
  assert.equal(upload.status, 201);
  const asset = await upload.json();
  assert.equal(asset.name, '中文录音.MP3');
  const body = { assetId: asset.id, language: 'auto', prompt: '', model: 'small.pt' };
  const key = id();
  const a = await (await s.req('/tasks', 'POST', body, key)).json();
  const b = await (await s.req('/tasks', 'POST', body, key)).json();
  assert.equal(a.id, b.id);
  assert.equal(a.model, 'small.pt');
  assert.equal((await s.req('/tasks', 'POST', { ...body, language: 'en' }, key)).status, 409);
  const media = await fetch(s.base + '/api/tasks/' + a.id + '/media', {
    headers: { range: 'bytes=0-2' },
  });
  assert.equal(media.status, 206);
  assert.equal(await media.text(), 'ID3');
  assert.equal((await s.req('/tasks/' + a.id + '/cancel', 'POST')).status, 200);
  assert.equal((await s.req('/tasks/' + a.id + '/retry', 'POST')).status, 200);
  assert.equal((await s.req('/tasks/' + a.id + '/exports/txt')).status, 409);
  assert.equal(
    (await s.req('/tasks', 'POST', { ...body, model: '../outside.pt' }, id())).status,
    422,
  );
});

test('Invalid upload extensions, empty files and pagination return actionable errors', async () => {
  const s = await setup();
  for (const [name, value] of [
    ['bad.exe', 'abc'],
    ['empty.mp3', ''],
  ]) {
    const form = new FormData();
    form.append('file', new Blob([value]), name);
    assert.equal((await s.req('/assets', 'POST', form)).status, 422);
  }
  assert.equal((await s.req('/tasks?page=0')).status, 422);
});

test('Legacy account schema is migrated to single-user schema without data loss', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'legacy-migrate-'));
  const legacy = new DatabaseSync(path.join(root, 'app.sqlite'));
  legacy.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL,password TEXT NOT NULL);
    CREATE TABLE idem(user_id TEXT NOT NULL,scope TEXT NOT NULL,key TEXT NOT NULL,hash TEXT NOT NULL,resource_id TEXT NOT NULL,PRIMARY KEY(user_id,scope,key));
    CREATE TABLE assets(id TEXT PRIMARY KEY,owner_id TEXT REFERENCES users(id),name TEXT NOT NULL,storage TEXT NOT NULL,size INTEGER NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE tasks(id TEXT PRIMARY KEY,owner_id TEXT REFERENCES users(id),asset_id TEXT REFERENCES assets(id),language TEXT NOT NULL,prompt TEXT NOT NULL,model TEXT NOT NULL,status TEXT NOT NULL,stage TEXT NOT NULL,attempt INTEGER NOT NULL DEFAULT 0,token TEXT,child_pid INTEGER,error_code TEXT,error TEXT,text TEXT,segments TEXT,result_dir TEXT,metadata TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE INDEX task_owner ON tasks(owner_id,created_at);
    CREATE TABLE attempts(id TEXT PRIMARY KEY,task_id TEXT REFERENCES tasks(id),number INTEGER NOT NULL,status TEXT NOT NULL,error TEXT,started_at TEXT NOT NULL,finished_at TEXT);
    CREATE TABLE task_events(id TEXT PRIMARY KEY,task_id TEXT REFERENCES tasks(id),message TEXT NOT NULL,created_at TEXT NOT NULL);
    INSERT INTO users VALUES('reporter','reporter@legacy.test','旧用户','legacy','disabled');
    INSERT INTO assets VALUES('a1','reporter','保留的录音.mp3','file1',64,'2026-01-01T00:00:00.000Z');
    INSERT INTO tasks VALUES('t1','reporter','a1','auto','','large-v3-turbo.pt','SUCCEEDED','已完成',1,NULL,NULL,NULL,NULL,'正文','[]','run-dir','{}','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
    INSERT INTO idem VALUES('reporter','tasks','key1','hash1','t1');
  `);
  legacy.close();

  const store = new Store(root);
  assert.equal(
    store.one("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name='users'").n,
    0,
  );
  const taskColumns = store.all('PRAGMA table_info(tasks)').map((c: any) => c.name);
  assert.ok(!taskColumns.includes('owner_id'));
  assert.equal(store.one('SELECT name FROM assets WHERE id=?', 'a1').name, '保留的录音.mp3');
  assert.equal(store.one('SELECT status FROM tasks WHERE id=?', 't1').status, 'SUCCEEDED');
  assert.equal(store.one('SELECT text FROM tasks WHERE id=?', 't1').text, '正文');
  assert.equal(
    store.one('SELECT resource_id FROM idem WHERE scope=? AND key=?', 'tasks', 'key1').resource_id,
    't1',
  );
  store.db.close();
  rmSync(root, { recursive: true, force: true });
});

test('LLM endpoint requires configuration', async () => {
  const s = await setup();
  const res = await s.req('/tasks/whatever/llm', 'POST', { action: 'polish' });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.code, 'LLM_UNAVAILABLE');
});

test('LLM polish works end-to-end against a local mock', async (t) => {
  const mockLlm = createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: '润色后的文本' } }] }));
    });
  });
  await new Promise<void>((r) => mockLlm.listen(0, '127.0.0.1', r));
  t.after(() => new Promise<void>((r) => mockLlm.close(() => r())));
  const llmPort = (mockLlm.address() as any).port;
  process.env.LLM_BASE_URL = `http://127.0.0.1:${llmPort}/v1`;
  process.env.LLM_API_KEY = 'test-key';
  process.env.LLM_MODEL = 'test-model';

  const s = await setup();
  const form = new FormData();
  form.append('file', new Blob(['audio-content'], { type: 'audio/mpeg' }), 'a.mp3');
  const asset = await (await s.req('/assets', 'POST', form)).json();
  const task = await (
    await s.req(
      '/tasks',
      'POST',
      { assetId: asset.id, language: 'auto', prompt: '', model: 'small.pt' },
      id(),
    )
  ).json();

  const early = await s.req('/tasks/' + task.id + '/llm', 'POST', { action: 'polish' });
  assert.equal(early.status, 409);

  s.store.run(
    "UPDATE tasks SET status='SUCCEEDED', text=?, language='zh' WHERE id=?",
    '你好，世界',
    task.id,
  );

  const ok = await s.req('/tasks/' + task.id + '/llm', 'POST', { action: 'polish' });
  assert.equal(ok.status, 201);
  const okBody = await ok.json();
  assert.equal(okBody.result, '润色后的文本');
  assert.equal(okBody.action, 'polish');

  const history = await s.req('/tasks/' + task.id + '/llm');
  const historyBody = await history.json();
  assert.equal(historyBody.rows.length, 1);
  assert.equal(historyBody.rows[0].result, '润色后的文本');
});
