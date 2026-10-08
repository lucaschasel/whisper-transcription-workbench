import React, { useState, useEffect, useRef, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AudioLines,
  FileAudio,
  FileText,
  ShieldCheck,
  Clock,
  ChevronRight,
  Check,
  AlertCircle,
  Download,
  RefreshCw,
  LoaderCircle,
} from 'lucide-react';
import './style.css';
import './personal.css';
const labels: Record<string, string> = {
  OPEN: '待处理',
  IN_PROGRESS: '处理中',
  RESOLVED: '已解决',
  CLOSED: '已关闭',
  QUEUED: '排队中',
  RUNNING: '转写中',
  CANCEL_REQUESTED: '正在取消',
  CANCELLED: '已取消',
  FAILED: '失败',
  SUCCEEDED: '已完成',
  low: '低',
  medium: '中',
  high: '高',
  urgent: '紧急',
};
const date = (v: string) =>
  new Date(v).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
const size = (n: number) =>
  n < 1024 * 1024
    ? `${Math.ceil(n / 1024)} KB`
    : n >= 1024 * 1024 * 1024
      ? `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`;
const uploadLimit = (maxMB: number) =>
  maxMB >= 1024 && maxMB % 1024 === 0 ? `${maxMB / 1024} GB` : `${maxMB} MB`;
class ApiProblem extends Error {
  constructor(
    message: string,
    public code: string,
    public requestId?: string,
  ) {
    super(message);
  }
}
async function api(url: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {
    'X-App-Request': '1',
    ...(options.body && !(options.body instanceof FormData)
      ? { 'Content-Type': 'application/json' }
      : {}),
    ...(options.headers as any),
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
  return result;
}
const send = (url: string, data: any = {}, method = 'POST', key?: string) =>
  api(url, { method, body: JSON.stringify(data), headers: key ? { 'Idempotency-Key': key } : {} });
function Badge({ value }: { value: string }) {
  return (
    <span className={`badge ${value}`}>
      <i />
      {labels[value] || value}
    </span>
  );
}
function ErrorBox({ error }: { error: any }) {
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
function App() {
  const [rows, setRows] = useState<any[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null),
    [worker, setWorker] = useState<any>(null),
    [error, setError] = useState<any>(null),
    [maxMB, setMaxMB] = useState(1024),
    [models, setModels] = useState<any[]>([]),
    [defaultModel, setDefaultModel] = useState('');
  const historyRef = useRef<HTMLDetailsElement>(null);
  async function load(signal?: AbortSignal) {
    try {
      const [list, health, meta] = await Promise.all([
        api('/tasks?page=' + page, { signal }),
        api('/worker-status', { signal }),
        api('/meta', { signal }),
      ]);
      setRows(list.rows);
      setTotal(list.total);
      setWorker(health);
      setMaxMB(meta.maxUploadMB);
      setModels(meta.models || []);
      setDefaultModel(meta.defaultModel || '');
      setError(null);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(e);
    }
  }
  useEffect(() => {
    const c = new AbortController();
    load(c.signal);
    const timer = setInterval(() => load(c.signal), 2500);
    return () => {
      c.abort();
      clearInterval(timer);
    };
  }, [page]);
  return (
    <div className="personal-app">
      <header className="personal-header">
        <div className="personal-brand">
          <AudioLines size={25} />
          <strong>听录</strong>
          <span>个人转写工具</span>
        </div>
        <button
          className="history-jump"
          onClick={() => {
            if (historyRef.current) {
              historyRef.current.open = true;
              historyRef.current.scrollIntoView({ behavior: 'smooth' });
            }
          }}
        >
          <Clock size={16} />
          我的记录
        </button>
      </header>
      <main className="personal-main">
        <div className="personal-intro">
          <span className="eyebrow">留住声音里的内容</span>
          <h1>放入录音，接下来交给听录。</h1>
          <p>选一个文件，转成文字或字幕。直接使用，结果保存在这台电脑。</p>
        </div>
        <ErrorBox error={error} />
        <div className="personal-desk">
          <Composer
            maxMB={maxMB}
            models={models}
            defaultModel={defaultModel}
            available={worker?.available !== false}
            done={(tid) => {
              setSelected(tid);
              setPage(1);
              load();
            }}
          />
          <div className="result-space">
            {selected ? (
              <TaskDetail
                key={selected}
                tid={selected}
                close={() => setSelected(null)}
                changed={() => load()}
              />
            ) : (
              <section className="result-placeholder">
                <div className="paper-stack">
                  <FileText size={45} />
                </div>
                <span className="eyebrow">你的文字会出现在这里</span>
                <h2>先选一段值得记录的声音</h2>
                <p>
                  访谈、课堂、语音备忘录……
                  <br />
                  完成后可以查看全文、校对时间轴，
                  <br />
                  下载 TXT、SRT、VTT 或 JSON。
                </p>
                <span className="private-note">
                  <ShieldCheck size={15} />
                  音视频仅在本机处理
                </span>
              </section>
            )}
          </div>
        </div>
        <p className={'engine-note ' + (worker?.available === false ? 'engine-warning' : '')}>
          <span className="engine-dot" />
          {worker?.message || '正在连接本地转写引擎…'}
        </p>
        <details ref={historyRef} className="personal-history">
          <summary>
            <span>
              <Clock size={17} />
              以前转写过的文件
            </span>
            <small>{total} 份记录</small>
          </summary>
          <div className="history-content">
            {rows.length === 0 ? (
              <p className="history-empty">还没有记录，完成第一次转写后会保存在这里。</p>
            ) : (
              rows.map((row) => (
                <button
                  className={'history-row ' + (selected === row.id ? 'selected' : '')}
                  key={row.id}
                  onClick={() => setSelected(row.id)}
                >
                  <FileAudio size={20} />
                  <span className="history-name">
                    <strong>{row.name}</strong>
                    <small>
                      {date(row.created_at)} · {size(row.size)}
                    </small>
                  </span>
                  <Badge value={row.status} />
                  <ChevronRight size={17} />
                </button>
              ))
            )}
            <div className="history-pages">
              <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                上一页
              </button>
              <span>
                {page} / {Math.max(1, Math.ceil(total / 10))}
              </span>
              <button disabled={page * 10 >= total} onClick={() => setPage((p) => p + 1)}>
                下一页
              </button>
            </div>
          </div>
        </details>
        <footer className="personal-footer">
          声音属于你，记录也属于你。识别完成后，建议再校对一次。
        </footer>
      </main>
    </div>
  );
}
function Composer({
  maxMB,
  models,
  defaultModel,
  available,
  done,
}: {
  maxMB: number;
  models: any[];
  defaultModel: string;
  available: boolean;
  done: (id: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null),
    [language, setLanguage] = useState('auto'),
    [model, setModel] = useState(defaultModel),
    [prompt, setPrompt] = useState(''),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [error, setError] = useState<any>(null),
    [dragging, setDragging] = useState(false),
    [preview, setPreview] = useState('');
  const input = useRef<HTMLInputElement>(null),
    uploaded = useRef<any>(null),
    key = useRef(crypto.randomUUID()),
    lock = useRef(false),
    activeUpload = useRef<XMLHttpRequest | null>(null);
  const invalid = file
    ? !file.size
      ? '文件为空，请重新选择。'
      : file.size > maxMB * 1024 * 1024
        ? `文件大小超过 ${uploadLimit(maxMB)}，请压缩或分段后上传。`
        : !/\.(wav|mp3|mp4|m4a|flac|ogg|webm)$/i.test(file.name)
          ? '暂不支持此格式，请选择 MP3、WAV、M4A、MP4 等音视频文件。'
          : ''
    : '';
  useEffect(() => {
    if (!file) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => () => activeUpload.current?.abort(), []);
  useEffect(() => {
    if (defaultModel && !models.some((candidate) => candidate.id === model)) {
      setModel(defaultModel);
      key.current = crypto.randomUUID();
    }
  }, [defaultModel, models, model]);
  function choose(f: File | null) {
    if (lock.current) return;
    setFile(f);
    uploaded.current = null;
    key.current = crypto.randomUUID();
    setError(null);
    setProgress(0);
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (lock.current || !file || invalid) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      if (!uploaded.current) {
        const form = new FormData();
        form.append('file', file);
        uploaded.current = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          activeUpload.current = xhr;
          xhr.open('POST', '/api/assets');
          xhr.timeout = 1800000;
          xhr.setRequestHeader('X-App-Request', '1');
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
          };
          xhr.onerror = () =>
            reject(new Error('上传连接中断，请确认本地服务正在运行，再点击重试。'));
          xhr.ontimeout = () => reject(new Error('上传超时，请重试或选择较小文件。'));
          xhr.onabort = () => reject(new Error('上传已取消。'));
          xhr.onload = () => {
            try {
              const d = JSON.parse(xhr.responseText);
              if (xhr.status < 200 || xhr.status >= 300)
                reject(new ApiProblem(d.message || '上传失败，请重试。', d.code));
              else resolve(d);
            } catch {
              reject(new Error('上传未完成，服务返回异常。请重试。'));
            }
          };
          xhr.send(form);
        });
      }
      const task = await send(
        '/tasks',
        { assetId: uploaded.current.id, language, prompt, model },
        'POST',
        key.current,
      );
      done(task.id);
      setFile(null);
      uploaded.current = null;
      key.current = crypto.randomUUID();
      if (input.current) input.current.value = '';
      setProgress(0);
    } catch (e) {
      setError(e);
    } finally {
      activeUpload.current = null;
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="composer">
      <form onSubmit={submit}>
        <div className="composer-title">
          <span>01</span>
          <h2>选择音频或视频</h2>
        </div>
        <div
          className={'drop-pad ' + (dragging ? 'dragging' : '')}
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files.length > 1) {
              setError(new Error('一次处理一个文件，请选择其中一份。'));
              return;
            }
            choose(e.dataTransfer.files[0] || null);
          }}
        >
          <input
            ref={input}
            id="audio-file"
            type="file"
            aria-label="选择音视频文件"
            accept=".wav,.mp3,.mp4,.m4a,.flac,.ogg,.webm"
            disabled={busy}
            onChange={(e) => choose(e.target.files?.[0] || null)}
          />
          <FileAudio size={36} />
          <strong>{file ? file.name : '将文件拖到这里'}</strong>
          <span>{file ? size(file.size) : '或从电脑里选择一份录音'}</span>
          <button
            type="button"
            className="pick-file"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            {file ? '重新选择' : '选择文件'}
          </button>
          <small>
            MP3 / WAV / M4A / MP4 / FLAC / OGG / WebM
            <br />
            最长 30 分钟 · 最大 {uploadLimit(maxMB)}
          </small>
        </div>
        {file && preview && !invalid && (
          <div className="source-preview">
            <audio controls src={preview} preload="metadata" aria-label="预听所选音频" />
            <p>已选择文件，点击下方按钮开始转写。</p>
          </div>
        )}
        {invalid && <ErrorBox error={new Error(invalid)} />}
        <label className="language-field">
          录音里的语言
          <select
            value={language}
            disabled={busy}
            onChange={(e) => {
              setLanguage(e.target.value);
              key.current = crypto.randomUUID();
            }}
          >
            {[
              ['auto', '自动识别'],
              ['zh', '中文'],
              ['en', '英语'],
              ['ja', '日语'],
              ['ko', '韩语'],
              ['fr', '法语'],
              ['de', '德语'],
              ['es', '西班牙语'],
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="language-field model-field">
          <span>
            识别模型
            <small>模型越大通常越准确，也会占用更多显存</small>
          </span>
          <select
            value={model}
            disabled={busy || models.length === 0}
            onChange={(e) => {
              setModel(e.target.value);
              key.current = crypto.randomUUID();
            }}
          >
            {models.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name} · {size(candidate.size)}
              </option>
            ))}
          </select>
        </label>
        <details className="prompt-options">
          <summary>人名、术语提示（可选）</summary>
          <textarea
            value={prompt}
            disabled={busy}
            maxLength={500}
            rows={3}
            placeholder="例如：录音中出现的人名或专业词汇"
            onChange={(e) => {
              setPrompt(e.target.value);
              key.current = crypto.randomUUID();
            }}
          />
        </details>
        <ErrorBox error={error} />
        {!available && (
          <ErrorBox error={new Error('本地转写引擎尚未就绪，请查看页面下方的环境提示。')} />
        )}
        {busy && (
          <div className="transfer-progress" role="status">
            <progress value={progress} max={100} />
            <span>{progress < 100 ? `正在上传 ${progress}%` : '文件已上传，正在开始转写…'}</span>
          </div>
        )}
        <button
          type="submit"
          className="start-transcription"
          disabled={busy || !file || !!invalid || !available || !model}
        >
          {busy ? <LoaderCircle className="spin" size={18} /> : <AudioLines size={18} />}{' '}
          {busy ? '正在提交…' : error ? '重试上传并转写' : '上传并开始转写'}
        </button>
        <p className="composer-tip">开始后可以继续选择其他文件，处理结果会自动更新。</p>
      </form>
    </section>
  );
}
function TaskDetail({
  tid,
  close,
  changed,
}: {
  tid: string;
  close: () => void;
  changed: () => void;
}) {
  const [t, setT] = useState<any>(null),
    [error, setError] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState('text');
  useEffect(() => {
    const c = new AbortController();
    async function load() {
      try {
        const result = await api('/tasks/' + tid, { signal: c.signal });
        setT(result);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError(e);
      }
    }
    load();
    const timer = setInterval(load, 2000);
    return () => {
      c.abort();
      clearInterval(timer);
    };
  }, [tid]);
  async function action(action: string) {
    setBusy(true);
    setError(null);
    try {
      await send(`/tasks/${tid}/${action}`);
      setT(await api('/tasks/' + tid));
      changed();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="result-panel" aria-label="转写结果">
      <div className="detail">
        <ErrorBox error={error} />
        {t ? (
          <>
            <div className="detail-heading">
              <span className="eyebrow">文字与字幕</span>
              <h2>{t.name}</h2>
              <audio
                controls
                preload="metadata"
                src={`/api/tasks/${tid}/media`}
                aria-label="播放原始音频"
              />
              <div>
                <Badge value={t.status} />
                <span>{size(t.size)}</span>
                <span className="muted">{date(t.created_at)}</span>
              </div>
            </div>
            <div className="task-stage">
              <AudioLines size={26} />
              <div>
                <strong>{t.stage}</strong>
                <p>
                  {t.status === 'QUEUED'
                    ? '任务已保存，处理器空闲后将开始转写。'
                    : t.status === 'RUNNING'
                      ? '关闭页面不会中断转写。长文件需要更多时间。'
                      : t.status === 'SUCCEEDED'
                        ? '文字与字幕已生成，请校对识别结果。'
                        : t.status === 'CANCELLED'
                          ? '任务已停止，你可以重新加入队列。'
                          : t.error || '请等待推理进程停止。'}
                </p>
              </div>
              {['QUEUED', 'RUNNING'].includes(t.status) && (
                <button className="secondary" disabled={busy} onClick={() => action('cancel')}>
                  取消任务
                </button>
              )}
              {['FAILED', 'CANCELLED'].includes(t.status) && (
                <button className="primary" disabled={busy} onClick={() => action('retry')}>
                  <RefreshCw size={16} />
                  重试
                </button>
              )}
            </div>
            {t.status === 'SUCCEEDED' && (
              <>
                <div className="result-toolbar">
                  <div className="tabs">
                    <button
                      className={tab === 'text' ? 'active' : ''}
                      onClick={() => setTab('text')}
                    >
                      全文
                    </button>
                    <button
                      className={tab === 'segments' ? 'active' : ''}
                      onClick={() => setTab('segments')}
                    >
                      字幕时间轴
                    </button>
                  </div>
                  <div className="downloads">
                    {['txt', 'srt', 'vtt', 'json'].map((f) => (
                      <a className="secondary" key={f} href={`/api/tasks/${tid}/exports/${f}`}>
                        <Download size={14} />
                        {f.toUpperCase()}
                      </a>
                    ))}
                  </div>
                </div>
                {tab === 'text' ? (
                  <p className="transcript">{t.text || '未检测到可识别的语音。'}</p>
                ) : (
                  <div className="segments">
                    {t.segments.map((s: any, i: number) => (
                      <div key={i}>
                        <time>
                          {Number(s.start).toFixed(1)}s — {Number(s.end).toFixed(1)}s
                        </time>
                        <p>{s.text}</p>
                      </div>
                    ))}
                  </div>
                )}
                {t.metadata && (
                  <p className="muted">
                    模型 {t.metadata.model} · 识别语言 {t.metadata.language} ·{' '}
                    {t.metadata.device?.toUpperCase()} · 本次处理 {t.metadata.elapsedSeconds} 秒
                  </p>
                )}
              </>
            )}
            <details className="run-details">
              <summary>查看处理记录</summary>
              <div className="attempts">
                {t.attempts.map((a: any) => (
                  <div key={a.number}>
                    <strong>第 {a.number} 次执行</strong>
                    <Badge value={a.status} />
                    <time>{date(a.started_at)}</time>
                    {a.error && <p>{a.error}</p>}
                  </div>
                ))}
              </div>
              <div className="timeline">
                {t.events.map((v: any, i: number) => (
                  <div key={i}>
                    <i />
                    <p>
                      {v.message}
                      <small>{date(v.created_at)}</small>
                    </p>
                  </div>
                ))}
              </div>
            </details>
          </>
        ) : (
          !error && (
            <div className="empty">
              <LoaderCircle className="spin" />
            </div>
          )
        )}
      </div>
    </section>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
