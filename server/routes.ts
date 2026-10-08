import express, { type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { mkdirSync, unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';
import { Store, id, now, sha } from './db.ts';
import { listWhisperModels } from './models.ts';
import { ApiError, body, fail } from './http.ts';
import { llmConfig, normalizeConfig, runLlm, translateTarget } from './llm.ts';

const ACCEPTED_EXT = ['.wav', '.mp3', '.mp4', '.m4a', '.flac', '.ogg', '.webm'];

export function registerTranscribeRoutes(store: Store, getWorkerStatus: () => any) {
  const router = express.Router();

  router.get('/meta', (_req, res) => {
    const catalog = listWhisperModels();
    res.json({
      mode: 'transcribe',
      personal: true,
      maxUploadMB: Number(process.env.MAX_UPLOAD_MB || 1024),
      ...catalog,
    });
  });

  router.get('/health', (_req, res) => res.json({ ok: true, mode: 'transcribe' }));

  const idem = (req: Request, scope: string, fn: () => string) => {
    const key = req.get('Idempotency-Key');
    if (!key || key.length > 128) fail(422, 'IDEMPOTENCY', '缺少有效的请求标识。');
    return store.tx(() => {
      const hash = sha(JSON.stringify(req.body));
      const row = store.one('SELECT * FROM idem WHERE scope=? AND key=?', scope, key);
      if (row) {
        if (row.hash !== hash) fail(409, 'IDEMPOTENCY_CONFLICT', '同一请求标识不能用于不同内容。');
        return row.resource_id;
      }
      const resource = fn();
      store.run('INSERT INTO idem VALUES(?,?,?,?)', scope, key, hash, resource);
      return resource;
    });
  };

  const getTask = (tid: string) => {
    const t = store.one(
      'SELECT t.*,a.name,a.size FROM tasks t JOIN assets a ON a.id=t.asset_id WHERE t.id=?',
      tid,
    );
    if (!t) fail(404, 'NOT_FOUND', '任务不存在。');
    return t;
  };

  const publicTask = (t: any) => {
    const { token, child_pid, result_dir, ...safe } = t;
    return safe;
  };

  const uploads = path.join(store.dir, 'uploads');
  mkdirSync(uploads, { recursive: true });
  const upload = multer({
    dest: uploads,
    limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 1024) * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) =>
      cb(null, ACCEPTED_EXT.includes(path.extname(file.originalname).toLowerCase())),
  });

  router.post('/assets', upload.single('file'), (req, res) => {
    if (!req.file) fail(422, 'FILE', '请选择 WAV、MP3、MP4、M4A、FLAC、OGG 或 WebM 文件。');
    const file = req.file!;
    if (!file.size) {
      unlinkSync(file.path);
      fail(422, 'FILE', '不能上传空文件。');
    }
    const aid = id();
    try {
      store.run(
        'INSERT INTO assets VALUES(?,?,?,?,?)',
        aid,
        Buffer.from(file.originalname, 'latin1').toString('utf8'),
        file.filename,
        file.size,
        now(),
      );
    } catch (e) {
      unlinkSync(file.path);
      throw e;
    }
    res.status(201).json({
      id: aid,
      name: store.one('SELECT name FROM assets WHERE id=?', aid).name,
      size: file.size,
    });
  });

  router.post('/tasks', (req, res) => {
    const i = body(
      req,
      z.object({
        assetId: z.string().uuid(),
        language: z.enum(['auto', 'zh', 'en', 'ja', 'ko', 'fr', 'de', 'es']),
        prompt: z.string().max(500).default(''),
        model: z.string().min(1).max(255).optional(),
      }),
    );
    const catalog = listWhisperModels();
    const selectedModel = i.model || catalog.defaultModel;
    if (!catalog.models.some((model) => model.id === selectedModel))
      fail(422, 'MODEL', '所选模型不存在，请刷新模型列表后重试。');
    if (!store.one('SELECT id FROM assets WHERE id=?', i.assetId))
      fail(404, 'ASSET', '文件不存在。');
    const tid = idem(req, 'tasks', () => {
      const tid = id();
      store.run(
        'INSERT INTO tasks(id,asset_id,language,prompt,model,status,stage,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
        tid,
        i.assetId,
        i.language,
        i.prompt,
        selectedModel,
        'QUEUED',
        '等待处理',
        now(),
        now(),
      );
      store.taskEvent(tid, `任务已创建 · ${path.basename(selectedModel, '.pt')}`);
      return tid;
    });
    res.status(201).json(publicTask(getTask(tid)));
  });

  router.get('/tasks', (req, res) => {
    const q = z
      .object({
        status: z
          .enum(['', 'QUEUED', 'RUNNING', 'CANCEL_REQUESTED', 'CANCELLED', 'FAILED', 'SUCCEEDED'])
          .default(''),
        page: z.coerce.number().int().positive().max(10000).default(1),
      })
      .parse(req.query);
    const conditions: string[] = [];
    const args: any[] = [];
    if (q.status) {
      conditions.push('t.status=?');
      args.push(q.status);
    }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    res.json({
      rows: store
        .all(
          `SELECT t.*,a.name,a.size FROM tasks t JOIN assets a ON a.id=t.asset_id ${where} ORDER BY t.created_at DESC,t.id DESC LIMIT 10 OFFSET ?`,
          ...args,
          (q.page - 1) * 10,
        )
        .map(publicTask),
      total: store.one(`SELECT count(*) n FROM tasks t ${where}`, ...args).n,
      page: q.page,
      counts: store.all('SELECT status,count(*) n FROM tasks GROUP BY status'),
    });
  });

  router.get('/tasks/:id', (req, res) => {
    const t = getTask(String(req.params.id));
    res.json({
      ...publicTask(t),
      segments: t.segments ? JSON.parse(t.segments) : [],
      metadata: t.metadata ? JSON.parse(t.metadata) : null,
      attempts: store.all(
        'SELECT number,status,error,started_at,finished_at FROM attempts WHERE task_id=? ORDER BY number DESC',
        t.id,
      ),
      events: store.all(
        'SELECT message,created_at FROM task_events WHERE task_id=? ORDER BY created_at DESC',
        t.id,
      ),
    });
  });

  router.post('/tasks/:id/cancel', (req, res) => {
    store.tx(() => {
      const t = getTask(String(req.params.id));
      if (!['QUEUED', 'RUNNING', 'CANCEL_REQUESTED'].includes(t.status))
        fail(409, 'TASK_STATE', '任务已结束，无法取消。');
      const state = t.status === 'QUEUED' ? 'CANCELLED' : 'CANCEL_REQUESTED';
      store.run(
        'UPDATE tasks SET status=?,stage=?,updated_at=? WHERE id=?',
        state,
        state === 'CANCELLED' ? '已取消' : '正在停止推理',
        now(),
        t.id,
      );
      store.taskEvent(t.id, '用户请求取消');
    });
    res.json({ ok: true });
  });

  router.post('/tasks/:id/retry', (req, res) => {
    store.tx(() => {
      const t = getTask(String(req.params.id));
      if (!['FAILED', 'CANCELLED'].includes(t.status))
        fail(409, 'TASK_STATE', '只有失败或已取消的任务可以重试。');
      store.run(
        "UPDATE tasks SET status='QUEUED',stage='等待处理',error=NULL,error_code=NULL,updated_at=? WHERE id=?",
        now(),
        t.id,
      );
      store.taskEvent(t.id, '用户重新排队');
    });
    res.json({ ok: true });
  });

  router.get('/tasks/:id/media', (req, res) => {
    const t = getTask(String(req.params.id));
    const asset = store.one('SELECT storage,name FROM assets WHERE id=?', t.asset_id);
    const file = path.join(uploads, asset.storage);
    if (!existsSync(file)) fail(404, 'MEDIA_MISSING', '原始文件已不存在。');
    res.type(path.extname(asset.name));
    res.sendFile(path.resolve(file));
  });

  router.get('/tasks/:id/exports/:format', (req, res) => {
    const t = getTask(String(req.params.id));
    const format = z.enum(['txt', 'srt', 'vtt', 'json']).parse(req.params.format);
    if (t.status !== 'SUCCEEDED' || !t.result_dir) fail(409, 'NOT_READY', '结果尚未生成。');
    const file = path.join(store.dir, 'results', t.id, t.result_dir, `transcript.${format}`);
    if (!existsSync(file)) fail(404, 'RESULT_MISSING', '结果文件缺失，请重新转写。');
    res.download(file, `transcript.${format}`);
  });

  router.post('/tasks/:id/llm', async (req, res, next) => {
    try {
      const i = body(
        req,
        z.object({
          action: z.enum(['polish', 'summary', 'translate']),
          llm: z
            .object({
              baseUrl: z.string().min(1).max(500),
              apiKey: z.string().min(1).max(500),
              model: z.string().min(1).max(200),
            })
            .optional(),
        }),
      );
      const config = normalizeConfig(i.llm) || llmConfig();
      if (!config)
        throw new ApiError(
          503,
          'LLM_UNAVAILABLE',
          '尚未配置 AI 后处理。请在下方设置 LLM 服务，或在 .env 中设置 LLM_BASE_URL、LLM_API_KEY 和 LLM_MODEL。',
        );
      const t = getTask(String(req.params.id));
      if (t.status !== 'SUCCEEDED') fail(409, 'NOT_READY', '任务尚未转写完成，无法处理。');
      const text = (t.text || '').trim();
      if (!text) fail(422, 'EMPTY_TEXT', '转写结果为空，没有可处理的文本。');
      const target = i.action === 'translate' ? translateTarget(t.language) : undefined;
      const result = await runLlm(config, i.action, text, target);
      const runId = id();
      const createdAt = now();
      store.run(
        'INSERT INTO llm_runs VALUES(?,?,?,?,?,?)',
        runId,
        t.id,
        i.action,
        target || null,
        result,
        createdAt,
      );
      store.taskEvent(t.id, `AI 处理完成 · ${i.action}`);
      res.status(201).json({
        id: runId,
        action: i.action,
        target: target || null,
        result,
        created_at: createdAt,
      });
    } catch (e) {
      if (e instanceof ApiError) return next(e);
      next(new ApiError(502, 'LLM_ERROR', (e as Error).message || 'AI 处理失败，请重试。'));
    }
  });

  router.get('/tasks/:id/llm', (req, res) => {
    const t = getTask(String(req.params.id));
    res.json({
      rows: store.all(
        'SELECT id,action,target,result,created_at FROM llm_runs WHERE task_id=? ORDER BY created_at DESC',
        t.id,
      ),
    });
  });

  router.get('/worker-status', (_req, res) =>
    res.json(getWorkerStatus() || { available: false, message: '任务处理器尚未启动' }),
  );

  return router;
}
