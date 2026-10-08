import { useEffect, useRef, useState } from 'react';
import { AudioLines, ChevronRight, Clock, FileAudio, FileText, ShieldCheck } from 'lucide-react';
import { api } from './lib/api.ts';
import { date, size } from './lib/format.ts';
import type { Meta, TaskListPage, TaskSummary, WhisperModel, WorkerStatus } from './lib/types.ts';
import { Badge } from './components/Badge.tsx';
import { Composer } from './components/Composer.tsx';
import { ErrorBox } from './components/ErrorBox.tsx';
import { TaskDetail } from './components/TaskDetail.tsx';

export function App() {
  const [rows, setRows] = useState<TaskSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [worker, setWorker] = useState<WorkerStatus | null>(null);
  const [error, setError] = useState<any>(null);
  const [maxMB, setMaxMB] = useState(1024);
  const [models, setModels] = useState<WhisperModel[]>([]);
  const [defaultModel, setDefaultModel] = useState('');
  const historyRef = useRef<HTMLDetailsElement>(null);

  async function load(signal?: AbortSignal) {
    try {
      const [list, health, meta] = await Promise.all([
        api<TaskListPage>('/tasks?page=' + page, { signal }),
        api<WorkerStatus>('/worker-status', { signal }),
        api<Meta>('/meta', { signal }),
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
              <TaskDetail key={selected} tid={selected} changed={() => load()} />
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
