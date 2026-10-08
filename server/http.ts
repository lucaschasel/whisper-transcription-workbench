import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const fail = (status: number, code: string, message: string): never => {
  throw new ApiError(status, code, message);
};

export const body = (req: Request, schema: z.ZodType<any>) => schema.parse(req.body);

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  const validation = err instanceof z.ZodError;
  const tooLarge = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
  const status = validation ? 422 : tooLarge ? 413 : err.status || 500;
  const message = validation
    ? '输入格式不正确，请检查必填项和长度。'
    : tooLarge
      ? '文件超过上传大小限制。'
      : err instanceof ApiError
        ? err.message
        : status >= 500
          ? '服务暂时遇到问题，请重试。'
          : err.message;
  console.error(
    JSON.stringify({
      requestId: res.locals.requestId,
      code: validation ? 'VALIDATION' : err.code || 'INTERNAL',
      message: err.message,
    }),
  );
  res.status(status).json({
    code: validation ? 'VALIDATION' : err.code || 'INTERNAL',
    message,
    requestId: res.locals.requestId,
    fieldErrors: validation ? err.flatten().fieldErrors : undefined,
  });
}
