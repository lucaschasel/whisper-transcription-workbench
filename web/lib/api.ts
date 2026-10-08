export class ApiProblem extends Error {
  constructor(
    message: string,
    public code: string,
    public requestId?: string,
  ) {
    super(message);
  }
}

export async function api<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'X-App-Request': '1',
    ...(options.body && !(options.body instanceof FormData)
      ? { 'Content-Type': 'application/json' }
      : {}),
    ...((options.headers as Record<string, string>) || {}),
  };
  let response: Response;
  try {
    response = await fetch('/api' + url, { ...options, headers });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiProblem('网络连接失败，请检查服务是否运行。', 'NETWORK');
  }
  const result = await response.json();
  if (!response.ok) {
    throw new ApiProblem(result.message, result.code, result.requestId);
  }
  return result as T;
}

export const send = <T = any>(url: string, data: any = {}, method = 'POST', key?: string) =>
  api<T>(url, {
    method,
    body: JSON.stringify(data),
    headers: key ? { 'Idempotency-Key': key } : {},
  });
