import express, { type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { mkdirSync, unlinkSync, existsSync, statSync, createReadStream } from 'node:fs';
import path from 'node:path';
import { Store, id, now, sha } from './db.ts';
import { listWhisperModels } from './models.ts';
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const fail = (status: number, code: string, message: string): never => {
  throw new ApiError(status, code, message);
};
const body = (req: Request, schema: z.ZodType<any>) => schema.parse(req.body);
export function createApp(store: Store) {
  const mode = 'transcribe';
  store.personalize();
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.locals.requestId = id();
    res.setHeader('X-Request-Id', res.locals.requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      if (
        req.get('X-App-Request') !== '1' ||
        (origin && origin !== `${req.protocol}://${req.get('host')}`)
      )
        return next(new ApiError(403, 'ORIGIN', '请求来源验证失败，请刷新后重试。'));
    }
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.get('/api/meta', (_req, res) => {
    const catalog = listWhisperModels();
    res.json({
      mode,
      personal: true,
      maxUploadMB: Number(process.env.MAX_UPLOAD_MB || 1024),
      ...catalog,
    });
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true, mode }));
  // Single local workspace: no passwords, login endpoints or session cookies.
  app.use('/api', (_req, res, next) => {
    res.locals.user = { id: 'local' };
    next();
  });
  const idem = (req: Request, res: Response, scope: string, fn: () => string) => {
    const key = req.get('Idempotency-Key');
    if (!key || key.length > 128) fail(422, 'IDEMPOTENCY', '缺少有效的请求标识。');
    return store.tx(() => {
      const hash = sha(JSON.stringify(req.body));
      const row = store.one(
        'SELECT * FROM idem WHERE user_id=? AND scope=? AND key=?',
        res.locals.user.id,
        scope,
        key,
      );
      if (row) {
        if (row.hash !== hash) fail(409, 'IDEMPOTENCY_CONFLICT', '同一请求标识不能用于不同内容。');
        return row.resource_id;
      }
      const resource = fn();
      store.run(
        'INSERT INTO idem VALUES(?,?,?,?,?)',
        res.locals.user.id,
        scope,
        key,
        hash,
        resource,
      );
      return resource;
    });
  };
  if (mode === 'transcribe') {
    const getTask = (tid: string, u: any) => {
      const t = store.one(
        'SELECT t.*,a.name,a.size FROM tasks t JOIN assets a ON a.id=t.asset_id WHERE t.id=? AND t.owner_id=?',
        tid,
        u.id,
      );
      if (!t) fail(404, 'NOT_FOUND', '任务不存在或你没有访问权限。');
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
        cb(
          null,
          ['.wav', '.mp3', '.mp4', '.m4a', '.flac', '.ogg', '.webm'].includes(
            path.extname(file.originalname).toLowerCase(),
          ),
        ),
    });
    app.post('/api/assets', upload.single('file'), (req, res) => {
      if (!req.file) fail(422, 'FILE', '请选择 WAV、MP3、MP4、M4A、FLAC、OGG 或 WebM 文件。');
      const file = req.file!;
      if (!file.size) {
        unlinkSync(file.path);
        fail(422, 'FILE', '不能上传空文件。');
      }
      const aid = id();
      try {
        store.run(
          'INSERT INTO assets VALUES(?,?,?,?,?,?)',
          aid,
          res.locals.user.id,
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
    app.post('/api/tasks', (req, res) => {
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
      if (
        !store.one('SELECT id FROM assets WHERE id=? AND owner_id=?', i.assetId, res.locals.user.id)
      )
        fail(404, 'ASSET', '文件不存在。');
      const tid = idem(req, res, 'tasks', () => {
        const tid = id();
        store.run(
          'INSERT INTO tasks(id,owner_id,asset_id,language,prompt,model,status,stage,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
          tid,
          res.locals.user.id,
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
      res.status(201).json(publicTask(getTask(tid, res.locals.user)));
    });
    app.get('/api/tasks', (req, res) => {
      const q = z
        .object({
          status: z
            .enum(['', 'QUEUED', 'RUNNING', 'CANCEL_REQUESTED', 'CANCELLED', 'FAILED', 'SUCCEEDED'])
            .default(''),
          page: z.coerce.number().int().positive().max(10000).default(1),
        })
        .parse(req.query);
      const args: any[] = [res.locals.user.id];
      let where = 't.owner_id=?';
      if (q.status) {
        where += ' AND t.status=?';
        args.push(q.status);
      }
      res.json({
        rows: store
          .all(
            `SELECT t.*,a.name,a.size FROM tasks t JOIN assets a ON a.id=t.asset_id WHERE ${where} ORDER BY t.created_at DESC,t.id DESC LIMIT 10 OFFSET ?`,
            ...args,
            (q.page - 1) * 10,
          )
          .map(publicTask),
        total: store.one(`SELECT count(*) n FROM tasks t WHERE ${where}`, ...args).n,
        page: q.page,
        counts: store.all(
          'SELECT status,count(*) n FROM tasks WHERE owner_id=? GROUP BY status',
          res.locals.user.id,
        ),
      });
    });
    app.get('/api/tasks/:id', (req, res) => {
      const t = getTask(String(req.params.id), res.locals.user);
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
    app.post('/api/tasks/:id/cancel', (req, res) => {
      store.tx(() => {
        const t = getTask(String(req.params.id), res.locals.user);
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
    app.post('/api/tasks/:id/retry', (req, res) => {
      store.tx(() => {
        const t = getTask(String(req.params.id), res.locals.user);
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
    app.get('/api/tasks/:id/media', (req, res) => {
      const t = getTask(String(req.params.id), res.locals.user);
      const asset = store.one('SELECT storage,name FROM assets WHERE id=?', t.asset_id);
      const file = path.join(uploads, asset.storage);
      if (!existsSync(file)) fail(404, 'MEDIA_MISSING', '原始文件已不存在。');
      res.type(path.extname(asset.name));
      res.sendFile(path.resolve(file));
    });
    app.get('/api/tasks/:id/exports/:format', (req, res) => {
      const t = getTask(String(req.params.id), res.locals.user);
      const format = z.enum(['txt', 'srt', 'vtt', 'json']).parse(req.params.format);
      if (t.status !== 'SUCCEEDED' || !t.result_dir) fail(409, 'NOT_READY', '结果尚未生成。');
      const file = path.join(store.dir, 'results', t.id, t.result_dir, `transcript.${format}`);
      if (!existsSync(file)) fail(404, 'RESULT_MISSING', '结果文件缺失，请重新转写。');
      res.download(file, `transcript.${format}`);
    });
    app.get('/api/worker-status', (_req, res) =>
      res.json(app.locals.workerStatus?.() || { available: false, message: '任务处理器尚未启动' }),
    );
  }
  app.use('/api', (_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', '接口不存在。')));
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const validation = err instanceof z.ZodError;
    const tooLarge = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
    const status = validation ? 422 : tooLarge ? 413 : err.status || 500;
    const message = validation
      ? '输入格式不正确，请检查必填项和长度。'
      : tooLarge
        ? '文件超过上传大小限制。'
        : status >= 500
          ? '服务暂时遇到问题，请重试。'
          : err.message;
    console.error(
      JSON.stringify({
        requestId: res.locals.requestId,
        code: err.code || 'INTERNAL',
        message: err.message,
      }),
    );
    res.status(status).json({
      code: validation ? 'VALIDATION' : err.code || 'INTERNAL',
      message,
      requestId: res.locals.requestId,
      fieldErrors: validation ? err.flatten().fieldErrors : undefined,
    });
  });
  return app;
}
