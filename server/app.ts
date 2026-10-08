import express from 'express';
import { Store, id } from './db.ts';
import { ApiError, errorHandler } from './http.ts';
import { registerTranscribeRoutes } from './routes.ts';

export function createApp(store: Store, getWorkerStatus: () => any = () => undefined) {
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
  app.use('/api', (req, _res, next) => {
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
  app.use('/api', registerTranscribeRoutes(store, getWorkerStatus));
  app.use('/api', (_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', '接口不存在。')));
  app.use(errorHandler);
  return app;
}
