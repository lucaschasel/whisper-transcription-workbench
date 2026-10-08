import { AlertCircle } from 'lucide-react';

export function ErrorBox({ error }: { error: any }) {
  return error ? (
    <div className="error" role="alert">
      <AlertCircle size={18} />
      <div>
        {error.message || String(error)}
        {error.requestId && <small>请求编号 {error.requestId.slice(0, 8)}</small>}
      </div>
    </div>
  ) : null;
}
