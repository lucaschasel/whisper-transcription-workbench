import { useState, useEffect, useRef, type FormEvent } from 'react';
import { AudioLines, FileAudio, LoaderCircle } from 'lucide-react';
import { ApiProblem, send } from '../lib/api.ts';
import { size, uploadLimit } from '../lib/format.ts';
import type { WhisperModel } from '../lib/types.ts';
import { ErrorBox } from './ErrorBox.tsx';

const LANGUAGES: [string, string][] = [
  ['auto', '自动识别'],
  ['zh', '中文'],
  ['en', '英语'],
  ['ja', '日语'],
  ['ko', '韩语'],
  ['fr', '法语'],
  ['de', '德语'],
  ['es', '西班牙语'],
];

const ACCEPTED_EXT = /\.(wav|mp3|mp4|m4a|flac|ogg|webm)$/i;

export function Composer({
  maxMB,
  models,
  defaultModel,
  available,
  done,
}: {
  maxMB: number;
  models: WhisperModel[];
  defaultModel: string;
  available: boolean;
  done: (id: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState('auto');
  const [model, setModel] = useState(defaultModel);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<any>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const uploaded = useRef<{ id: string } | null>(null);
  const key = useRef(crypto.randomUUID());
  const lock = useRef(false);
  const activeUpload = useRef<XMLHttpRequest | null>(null);

  const invalid = file
    ? !file.size
      ? '文件为空，请重新选择。'
      : file.size > maxMB * 1024 * 1024
        ? `文件大小超过 ${uploadLimit(maxMB)}，请压缩或分段后上传。`
        : !ACCEPTED_EXT.test(file.name)
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
        uploaded.current = await new Promise<{ id: string }>((resolve, reject) => {
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
      const task = await send<{ id: string }>(
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
            {LANGUAGES.map(([v, l]) => (
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
