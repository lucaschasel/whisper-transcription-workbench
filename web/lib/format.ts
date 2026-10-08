export const statusLabels: Record<string, string> = {
  QUEUED: '排队中',
  RUNNING: '转写中',
  CANCEL_REQUESTED: '正在取消',
  CANCELLED: '已取消',
  FAILED: '失败',
  SUCCEEDED: '已完成',
};

export const date = (v: string) =>
  new Date(v).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

export const size = (n: number) =>
  n < 1024 * 1024
    ? `${Math.ceil(n / 1024)} KB`
    : n >= 1024 * 1024 * 1024
      ? `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`;

export const uploadLimit = (maxMB: number) =>
  maxMB >= 1024 && maxMB % 1024 === 0 ? `${maxMB / 1024} GB` : `${maxMB} MB`;
