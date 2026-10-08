import { useEffect, useState } from 'react';
import { AudioLines, Download, LoaderCircle, RefreshCw, Settings2 } from 'lucide-react';
import { api, send } from '../lib/api.ts';
import { date, size } from '../lib/format.ts';
import { loadLlmConfig, saveLlmConfig, LLM_PRESETS, type LlmClientConfig } from '../lib/llm.ts';
import type { LlmAction, TaskDetail as TaskDetailData } from '../lib/types.ts';
import { Badge } from './Badge.tsx';
import { ErrorBox } from './ErrorBox.tsx';

const LLM_LABELS: Record<LlmAction, string> = {
  polish: '润色字幕',
  summary: '摘要',
  translate: '翻译',
};

export function TaskDetail({ tid, changed }: { tid: string; changed: () => void }) {
  const [t, setT] = useState<TaskDetailData | null>(null);
  const [error, setError] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'text' | 'segments'>('text');
  const [llmBusy, setLlmBusy] = useState(false);
  const [llmError, setLlmError] = useState<any>(null);
  const [llmResult, setLlmResult] = useState<{
    action: LlmAction;
    target: string | null;
    result: string;
  } | null>(null);
  const [llmSettings, setLlmSettings] = useState<LlmClientConfig>(
    () => loadLlmConfig() || { baseUrl: '', apiKey: '', model: '' },
  );
  const [presetId, setPresetId] = useState('');
  const [showConfig, setShowConfig] = useState(false);

  useEffect(() => {
    const c = new AbortController();
    async function load() {
      try {
        const result = await api<TaskDetailData>('/tasks/' + tid, { signal: c.signal });
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
      setT(await api<TaskDetailData>('/tasks/' + tid));
      changed();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function runLlm(llmAction: LlmAction) {
    setLlmBusy(true);
    setLlmError(null);
    setLlmResult(null);
    const { baseUrl, apiKey, model } = llmSettings;
    const hasConfig = baseUrl.trim() && apiKey.trim() && model.trim();
    const body = hasConfig
      ? {
          action: llmAction,
          llm: { baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim() },
        }
      : { action: llmAction };
    try {
      const result = await send<{ action: LlmAction; target: string | null; result: string }>(
        `/tasks/${tid}/llm`,
        body,
      );
      setLlmResult(result);
    } catch (e) {
      setLlmError(e);
    } finally {
      setLlmBusy(false);
    }
  }

  function applyPreset(id: string) {
    const preset = LLM_PRESETS.find((p) => p.id === id);
    if (preset) setLlmSettings((s) => ({ ...s, baseUrl: preset.baseUrl, model: preset.model }));
  }

  function saveConfig() {
    const config = {
      baseUrl: llmSettings.baseUrl.trim(),
      apiKey: llmSettings.apiKey.trim(),
      model: llmSettings.model.trim(),
    };
    saveLlmConfig(config);
    setLlmSettings(config);
    setShowConfig(false);
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
                    {t.segments.map((s, i) => (
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
                <div className="llm-panel">
                  <div className="llm-head">
                    <span className="eyebrow">AI 后处理</span>
                    <div className="llm-actions">
                      <button
                        className="secondary"
                        disabled={llmBusy}
                        onClick={() => runLlm('polish')}
                      >
                        润色字幕
                      </button>
                      <button
                        className="secondary"
                        disabled={llmBusy}
                        onClick={() => runLlm('summary')}
                      >
                        生成摘要
                      </button>
                      <button
                        className="secondary"
                        disabled={llmBusy}
                        onClick={() => runLlm('translate')}
                      >
                        翻译
                      </button>
                      <button
                        className={'llm-settings ' + (showConfig ? 'active' : '')}
                        disabled={llmBusy}
                        onClick={() => setShowConfig((s) => !s)}
                      >
                        <Settings2 size={14} />
                        设置
                      </button>
                    </div>
                  </div>
                  {showConfig && (
                    <div className="llm-config">
                      <label className="llm-config-row">
                        <span>服务商</span>
                        <select
                          value={presetId}
                          onChange={(e) => {
                            setPresetId(e.target.value);
                            applyPreset(e.target.value);
                          }}
                        >
                          <option value="">自定义</option>
                          {LLM_PRESETS.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="llm-config-row">
                        <span>Base URL</span>
                        <input
                          value={llmSettings.baseUrl}
                          placeholder="https://api.deepseek.com/v1"
                          onChange={(e) => {
                            setPresetId('');
                            setLlmSettings((s) => ({ ...s, baseUrl: e.target.value }));
                          }}
                        />
                      </label>
                      <label className="llm-config-row">
                        <span>模型</span>
                        <input
                          value={llmSettings.model}
                          placeholder="deepseek-chat"
                          onChange={(e) => {
                            setPresetId('');
                            setLlmSettings((s) => ({ ...s, model: e.target.value }));
                          }}
                        />
                      </label>
                      <label className="llm-config-row">
                        <span>API Key</span>
                        <input
                          type="password"
                          value={llmSettings.apiKey}
                          placeholder="sk-…"
                          autoComplete="off"
                          onChange={(e) =>
                            setLlmSettings((s) => ({ ...s, apiKey: e.target.value }))
                          }
                        />
                      </label>
                      <div className="llm-config-foot">
                        <button className="primary" onClick={saveConfig}>
                          保存
                        </button>
                        <span className="muted">配置仅保存在这台电脑的浏览器里</span>
                      </div>
                    </div>
                  )}
                  {llmBusy && (
                    <p className="llm-status">
                      <LoaderCircle className="spin" size={14} /> 正在请求 AI，请稍候…
                    </p>
                  )}
                  <ErrorBox error={llmError} />
                  {llmResult && (
                    <div className="llm-result">
                      <strong>
                        {LLM_LABELS[llmResult.action]}
                        {llmResult.target
                          ? `（${llmResult.target === 'en' ? '英文' : '中文'}）`
                          : ''}
                      </strong>
                      <p>{llmResult.result}</p>
                    </div>
                  )}
                </div>
              </>
            )}
            <details className="run-details">
              <summary>查看处理记录</summary>
              <div className="attempts">
                {t.attempts.map((a) => (
                  <div key={a.number}>
                    <strong>第 {a.number} 次执行</strong>
                    <Badge value={a.status} />
                    <time>{date(a.started_at)}</time>
                    {a.error && <p>{a.error}</p>}
                  </div>
                ))}
              </div>
              <div className="timeline">
                {t.events.map((v, i) => (
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
