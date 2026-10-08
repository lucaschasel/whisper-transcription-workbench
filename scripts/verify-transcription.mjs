import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const base = process.env.VERIFY_URL || 'http://127.0.0.1:4320';
const mediaSource = process.env.VERIFY_MEDIA;
assert.ok(mediaSource, 'Set VERIFY_MEDIA to a readable local audio or video file.');
async function request(route, method = 'GET', body, key) {
  const response = await fetch(base + '/api' + route, {
    method,
    headers: {
      'X-App-Request': '1',
      ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  assert.ok(response.ok, JSON.stringify(result));
  return result;
}
async function upload(name, bytes) {
  const form = new FormData();
  form.append('file', new Blob([bytes]), name);
  return request('/assets', 'POST', form);
}
async function create(asset) {
  return request(
    '/tasks',
    'POST',
    { assetId: asset.id, language: 'zh', prompt: '以下是简体中文的录音。' },
    crypto.randomUUID(),
  );
}
async function wait(task) {
  for (let i = 0; i < 240; i++) {
    const t = await request('/tasks/' + task.id);
    if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(t.status)) return t;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Real transcription timed out');
}
const checks = [];
const sourceName = mediaSource.replaceAll('\\', '/').split('/').at(-1) || 'verification-media.wav';
for (const [name, source] of [[sourceName, mediaSource]]) {
  const task = await create(await upload(name, await readFile(source)));
  const t = await wait(task);
  assert.equal(t.status, 'SUCCEEDED', JSON.stringify(t));
  assert.ok(t.text.trim().length > 5);
  assert.ok(t.segments.every((s) => s.start >= 0 && s.end >= s.start));
  for (const format of ['txt', 'srt', 'vtt', 'json']) {
    const response = await fetch(`${base}/api/tasks/${task.id}/exports/${format}`, {
      headers: {},
    });
    assert.equal(response.status, 200);
    const data = await response.text();
    assert.ok(data.length > 0);
    if (format === 'srt') assert.match(data, /-->/);
    if (format === 'vtt') assert.match(data, /WEBVTT/);
    if (format === 'json') assert.ok(JSON.parse(data).segments.length);
  }
  checks.push({
    name,
    taskId: t.id,
    status: t.status,
    text: t.text,
    metadata: t.metadata,
    downloads: ['txt', 'srt', 'vtt', 'json'],
  });
  console.log(JSON.stringify(checks.at(-1)));
}
const invalid = await create(
  await upload('损坏文件验收.wav', Buffer.from('This is not valid audio.')),
);
const failed = await wait(invalid);
assert.equal(failed.status, 'FAILED');
assert.equal(failed.error_code, 'INVALID_MEDIA');
checks.push({
  name: 'invalid media',
  taskId: invalid.id,
  status: failed.status,
  errorCode: failed.error_code,
});
const queued = await create(await upload('取消任务验收.wav', await readFile(mediaSource)));
await request('/tasks/' + queued.id + '/cancel', 'POST', {});
const cancelled = await wait(queued);
assert.equal(cancelled.status, 'CANCELLED');
checks.push({ name: 'cancel', taskId: queued.id, status: cancelled.status });
await mkdir('docs', { recursive: true });
await writeFile(
  'docs/real-transcription-check.json',
  JSON.stringify({ checkedAt: new Date().toISOString(), checks }, null, 2),
);
console.log('Real media, downloads, invalid media and cancellation verified.');
