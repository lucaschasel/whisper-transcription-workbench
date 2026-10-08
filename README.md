# 听录 · 本地 Whisper 转写工作台

一个面向个人使用的本地音视频转写工具。React + TypeScript 前端，Express + SQLite 后端，调用本机 OpenAI Whisper 模型完成识别。无需账号，音视频和结果保存在自己的电脑上。

## 功能

- 拖入或选择 MP3、WAV、M4A、MP4、FLAC、OGG、WebM，上传前可预听。
- 自动发现本机模型目录中的 `.pt` 文件，每个任务可独立选择模型。
- 查看全文和字幕时间轴，导出 TXT、SRT、VTT、JSON。
- 转写完成后可用 AI 润色字幕、生成摘要或翻译（可选，任意 OpenAI 兼容接口）。
- 本机任务队列、进度显示、取消、失败重试和历史记录。
- 默认单文件最大 1 GB、媒体最长 30 分钟，均在本机处理。

## 环境要求

- Windows 10/11
- Node.js 24 或更高版本
- Python 3.10–3.12
- 一个或多个与 `openai-whisper` 兼容的 `.pt` 模型
- NVIDIA GPU 为可选项；没有 CUDA 时会使用 CPU，但速度会明显变慢

## 安装

```powershell
git clone https://github.com/YOUR-NAME/YOUR-REPOSITORY.git
cd YOUR-REPOSITORY
npm ci
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
```

如果需要 NVIDIA GPU 加速，请根据自己的 CUDA 环境先从 [PyTorch 官方安装页](https://pytorch.org/get-started/locally/)安装对应版本的 PyTorch。

## 使用自己的模型

可以直接使用已有模型。打开 `.env`，填写本机 Python 和任意一个模型的路径：

```dotenv
WHISPER_PYTHON=.venv/Scripts/python.exe
WHISPER_MODEL=D:/whisper-models/large-v3-turbo.pt
```

程序会扫描 `WHISPER_MODEL` 所在文件夹内的所有 `.pt` 文件，并把它们显示在页面的“识别模型”下拉框中。因此其他人克隆项目后，可以使用自己的模型目录，不需要修改源码。

如果还没有模型，可以在安装 Python 依赖后让 Whisper 下载一个模型，例如：

```powershell
New-Item -ItemType Directory -Force models
.\.venv\Scripts\python.exe -c "import whisper; whisper.load_model('small', download_root='models', device='cpu')"
```

随后把 `.env` 中的 `WHISPER_MODEL` 改成 `models/small.pt`。模型文件通常很大，已被 `.gitignore` 排除，不应提交到 GitHub。

## AI 后处理（可选）

转写完成后，可以在结果面板里对文本做「润色字幕」「生成摘要」或「翻译」。这些功能使用任意 OpenAI 兼容接口，在 `.env` 里配置：

```dotenv
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=sk-你的密钥
LLM_MODEL=deepseek-chat
```

不配置这三项时，转写功能照常工作，页面不显示 AI 后处理入口。翻译方向会自动判断：源语言为中文时翻成英文，否则翻成中文。

## 启动

```powershell
npm run build
npm start
```

访问 <http://127.0.0.1:4320>。Windows 用户也可以双击 `启动项目.cmd`，停止时双击 `停止项目.cmd`。

常用开发命令：

```powershell
npm run typecheck
npm test
npm run build
```

## 本地数据和隐私

数据库、上传文件、识别结果和日志保存在 `data/`。`.env`、`data/`、`models/`、`.venv/` 和 `*.pt` 均被 Git 忽略，不会随正常的 `git add .` 上传。服务只监听 `127.0.0.1`。

前端入口为 `web/main.tsx`（页面组件在 `web/components/`，工具与类型在 `web/lib/`），服务端入口为 `server/main.ts`（路由在 `server/routes.ts`，数据层在 `server/db.ts`，共享错误处理在 `server/http.ts`），Whisper 子进程为 `worker/transcribe.py`。接口说明见 `docs/API.md`，设计说明见 `docs/ENGINEERING.md`。
