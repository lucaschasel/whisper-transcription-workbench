import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store, id, now } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import type { Server } from 'node:http';
const resources: { root: string; store: Store; server: Server }[] = [];
const previousModel = process.env.WHISPER_MODEL;
const testModelRoot = mkdtempSync(path.join(os.tmpdir(), 'personal-models-'));
process.env.WHISPER_MODEL = path.join(testModelRoot, 'large-v3-turbo.pt');
writeFileSync(process.env.WHISPER_MODEL, 'test model');
writeFileSync(path.join(testModelRoot, 'small.pt'), 'another test model');
async function setup(legacy = false) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'personal-audio-'));
  const store = new Store(root);
  if (legacy) {
    store.run(
      "INSERT INTO users(id,email,name,role,password) VALUES('reporter','reporter@legacy.test','旧用户','legacy','disabled')",
    );
    store.run(
      'INSERT INTO assets VALUES(?,?,?,?,?,?)',
      id(),
      'reporter',
      '保留的录音.mp3',
      'legacy',
      64,
      now(),
    );
  }
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
});
test('Personal workspace needs no login, has no auth routes, and preserves legacy files', async () => {
  const s = await setup(true);
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
  assert.equal(s.store.one('SELECT owner_id FROM assets').owner_id, 'local');
  const count = s.store.one('SELECT count(*) n FROM assets').n;
  s.store.personalize();
  assert.equal(s.store.one('SELECT count(*) n FROM assets').n, count);
});
test('No-login mode still rejects foreign-origin and unmarked mutation requests', async () => {
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
