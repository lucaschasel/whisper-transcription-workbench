import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { Store, id, now } from './db.ts';
import { listWhisperModels, resolveWhisperModel } from './models.ts';
export class Transcriber {
  private timer?: NodeJS.Timeout;
  private child?: ChildProcess;
  private stopped = false;
  private busy = false;
  python =
    process.env.WHISPER_PYTHON ||
    (process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  constructor(private store: Store) {}
  status = () => {
    const models = listWhisperModels().models;
    return {
      available: existsSync(this.python) && models.length > 0,
      busy: this.busy,
      message: !existsSync(this.python)
        ? '未找到 Python 环境，请配置 WHISPER_PYTHON'
        : models.length === 0
          ? '模型目录中没有可用的 .pt 模型'
          : this.busy
            ? '正在处理任务'
            : `已就绪 · ${models.length} 个模型 · 单任务推理`,
    };
  };
  start() {
    this.store.tx(() => {
      for (const t of this.store.all(
        "SELECT id FROM tasks WHERE status IN ('RUNNING','CANCEL_REQUESTED')",
      )) {
        this.store.run(
          "UPDATE tasks SET status='FAILED',stage='执行中断',error_code='INTERRUPTED',error='服务在转写期间停止，请重试。',child_pid=NULL,updated_at=? WHERE id=?",
          now(),
          t.id,
        );
        this.store.run(
          "UPDATE attempts SET status='FAILED',error='服务中断',finished_at=? WHERE task_id=? AND status='RUNNING'",
          now(),
          t.id,
        );
        this.store.taskEvent(t.id, '服务重启，已将未完成的执行标记为中断');
      }
    });
    // The old Python child watchdog exits when its parent disappears.
    this.timer = setTimeout(() => this.tick(), 2500);
  }
  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    if (this.child) await this.kill(this.child);
  }
  private kill(child: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
      if (!child.pid || child.exitCode !== null) {
        resolve();
        return;
      }
      if (process.platform === 'win32') {
        const p = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
        p.once('close', () => resolve());
        p.once('error', () => {
          child.kill();
          resolve();
        });
      } else {
        child.kill('SIGTERM');
        resolve();
      }
    });
  }
  private async tick() {
    if (this.stopped) return;
    try {
      if (this.status().available && !this.busy) {
        const task = this.store.tx(() => {
          const t = this.store.one(
            "SELECT t.*,a.storage,a.name FROM tasks t JOIN assets a ON a.id=t.asset_id WHERE status='QUEUED' ORDER BY t.created_at LIMIT 1",
          );
          if (!t) return null;
          const token = id();
          this.store.run(
            "UPDATE tasks SET status='RUNNING',stage='检查文件',attempt=attempt+1,token=?,error=NULL,error_code=NULL,updated_at=? WHERE id=?",
            token,
            now(),
            t.id,
          );
          this.store.run(
            'INSERT INTO attempts(id,task_id,number,status,started_at) VALUES(?,?,?,?,?)',
            token,
            t.id,
            t.attempt + 1,
            'RUNNING',
            now(),
          );
          this.store.taskEvent(t.id, `开始第 ${t.attempt + 1} 次处理`);
          return { ...t, token, attempt: t.attempt + 1 };
        });
        if (task) {
          this.busy = true;
          await this.execute(task);
          this.busy = false;
        }
      }
    } catch (e) {
      this.busy = false;
      console.error('worker', e);
    } finally {
      if (!this.stopped) this.timer = setTimeout(() => this.tick(), 700);
    }
  }
  private async execute(task: any) {
    const dir = path.join(this.store.dir, 'results', task.id, task.token);
    mkdirSync(dir, { recursive: true });
    const selectedModel = resolveWhisperModel(task.model);
    if (!selectedModel) {
      const message = '任务选择的模型已从模型目录移除，请重新选择模型后创建任务。';
      this.store.tx(() => {
        this.store.run(
          "UPDATE tasks SET status='FAILED',stage='处理失败',child_pid=NULL,error_code='MODEL_MISSING',error=?,updated_at=? WHERE id=? AND token=?",
          message,
          now(),
          task.id,
          task.token,
        );
        this.store.run(
          "UPDATE attempts SET status='FAILED',error=?,finished_at=? WHERE id=?",
          message,
          now(),
          task.token,
        );
        this.store.taskEvent(task.id, message);
      });
      return;
    }
    const args = [
      path.resolve('worker/transcribe.py'),
      '--input',
      path.join(this.store.dir, 'uploads', task.storage),
      '--output',
      dir,
      '--model',
      selectedModel,
      '--language',
      task.language,
      '--prompt',
      task.prompt,
      '--parent',
      String(process.pid),
    ];
    const child = spawn(this.python, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    this.child = child;
    this.store.run(
      'UPDATE tasks SET child_pid=? WHERE id=? AND token=?',
      child.pid || null,
      task.id,
      task.token,
    );
    let output = '',
      stderr = '',
      errorMessage = '',
      errorCode = 'TRANSCRIBE_ERROR',
      timedOut = false,
      killSent = false;
    child.stdout?.on('data', (chunk) => {
      output += chunk.toString();
      let end;
      while ((end = output.indexOf('\n')) >= 0) {
        const line = output.slice(0, end);
        output = output.slice(end + 1);
        try {
          const data = JSON.parse(line);
          if (data.stage)
            this.store.run(
              "UPDATE tasks SET stage=?,updated_at=? WHERE id=? AND token=? AND status='RUNNING'",
              data.stage,
              now(),
              task.id,
              task.token,
            );
          if (data.error) {
            errorMessage = data.error;
            errorCode = data.code || errorCode;
          }
        } catch {}
      }
      if (output.length > 100000) output = '';
    });
    child.stderr?.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    const started = Date.now();
    const timeout = Number(process.env.TRANSCRIBE_TIMEOUT_SECONDS || 3600) * 1000;
    const monitor = setInterval(() => {
      const t = this.store.one('SELECT status FROM tasks WHERE id=?', task.id);
      if (
        !killSent &&
        (t?.status === 'CANCEL_REQUESTED' || Date.now() - started > timeout || this.stopped)
      ) {
        killSent = true;
        timedOut = Date.now() - started > timeout;
        void this.kill(child);
      }
    }, 400);
    const code = await new Promise<number | null>((resolve) => {
      child.once('error', (e) => {
        errorMessage = '无法启动推理进程，请检查 Python 环境。';
        errorCode = 'START_FAILED';
        resolve(-1);
      });
      child.once('close', resolve);
    });
    clearInterval(monitor);
    this.child = undefined;
    this.store.tx(() => {
      const current = this.store.one('SELECT status,token FROM tasks WHERE id=?', task.id);
      if (current?.token !== task.token) return;
      if (current.status === 'CANCEL_REQUESTED') {
        this.store.run(
          "UPDATE tasks SET status='CANCELLED',stage='已取消',child_pid=NULL,updated_at=? WHERE id=?",
          now(),
          task.id,
        );
        this.store.run(
          "UPDATE attempts SET status='CANCELLED',finished_at=? WHERE id=?",
          now(),
          task.token,
        );
        this.store.taskEvent(task.id, '推理已停止，任务取消');
        return;
      }
      try {
        if (code !== 0)
          throw new Error(
            timedOut
              ? '转写超过时间限制，请缩短文件后重试。'
              : errorMessage || '转写进程意外退出，请检查推理环境或重新上传文件。',
          );
        const result = JSON.parse(readFileSync(path.join(dir, 'transcript.json'), 'utf8'));
        const metadata = JSON.parse(readFileSync(path.join(dir, 'metadata.json'), 'utf8'));
        for (const ext of ['txt', 'srt', 'vtt', 'json'])
          if (!existsSync(path.join(dir, `transcript.${ext}`)))
            throw new Error('结果生成不完整，请重试。');
        this.store.run(
          "UPDATE tasks SET status='SUCCEEDED',stage='已完成',child_pid=NULL,text=?,segments=?,result_dir=?,metadata=?,updated_at=? WHERE id=?",
          result.text || '',
          JSON.stringify(result.segments || []),
          task.token,
          JSON.stringify(metadata),
          now(),
          task.id,
        );
        this.store.run(
          "UPDATE attempts SET status='SUCCEEDED',finished_at=? WHERE id=?",
          now(),
          task.token,
        );
        this.store.taskEvent(task.id, '转写完成，结果已保存');
      } catch (e) {
        const message = (e as Error).message;
        this.store.run(
          "UPDATE tasks SET status='FAILED',stage='处理失败',child_pid=NULL,error_code=?,error=?,updated_at=? WHERE id=?",
          timedOut ? 'TIMEOUT' : errorCode,
          message,
          now(),
          task.id,
        );
        this.store.run(
          "UPDATE attempts SET status='FAILED',error=?,finished_at=? WHERE id=?",
          message,
          now(),
          task.token,
        );
        this.store.taskEvent(task.id, message);
        console.error(
          JSON.stringify({ taskId: task.id, attempt: task.token, error: message, stderr }),
        );
      }
    });
  }
}
