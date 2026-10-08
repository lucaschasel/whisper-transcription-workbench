# 个人工作台 API

接口前缀 `/api`，无需登录，不签发会话 Cookie。写请求要求 `X-App-Request: 1`；若存在 Origin，必须与当前服务同源。JSON 请求使用 `Content-Type: application/json`。服务仅监听本机。

错误体：`{ code, message, requestId, fieldErrors? }`。422 输入或业务规则错误，403 请求来源错误，404 资源不存在，409 状态／幂等冲突，413 上传超限。

| 方法 | 路径                       | 契约                                                           |
| ---- | -------------------------- | -------------------------------------------------------------- |
| GET  | /meta                      | mode、personal、maxUploadMB、models、defaultModel              |
| GET  | /health                    | 存活状态                                                       |
| POST | /assets                    | multipart/form-data，单文件字段 file；返回 id、name、size      |
| POST | /tasks                     | `{assetId,language,prompt,model}`；要求 Idempotency-Key        |
| GET  | /tasks                     | status、page；每页 10 条                                       |
| GET  | /tasks/:id                 | 状态、阶段、正文、segments、metadata、attempts、events         |
| GET  | /tasks/:id/media           | 原始音视频；支持 Range 分段播放                                |
| POST | /tasks/:id/cancel          | 取消；运行中先变成 CANCEL_REQUESTED                            |
| POST | /tasks/:id/retry           | 仅 FAILED、CANCELLED 可重新排队                                |
| GET  | /tasks/:id/exports/:format | 成功后下载 txt、srt、vtt、json                                 |
| POST | /tasks/:id/llm             | `{action: polish/summary/translate}`，对已转写文本做 AI 后处理 |
| GET  | /tasks/:id/llm             | 该任务的历史 AI 处理记录                                       |
| GET  | /worker-status             | 本地推理配置检查、busy、提示                                   |

默认单文件上限为 1024 MB（1 GB），可通过 `MAX_UPLOAD_MB` 调整；媒体实际时长仍限制为 30 分钟。

language：auto、zh、en、ja、ko、fr、de、es。prompt 最多 500 字符。任务状态：QUEUED、RUNNING、SUCCEEDED、FAILED、CANCEL_REQUESTED、CANCELLED。

`models` 仅返回配置目录中实际存在的 `.pt` 文件，包含 id、name、size、isDefault。创建任务时的 model 必须使用其中一个 id；省略时使用 defaultModel。服务端不会接受任意文件路径。

同一幂等键和同一请求内容返回原任务；同键不同内容返回 409。重复重试不会生成多个活动执行。配置路径存在不代表一定能完成推理，文件解码、模型加载与 GPU 错误会保存到任务详情。

不提供登录、退出、用户或工单接口，数据库不包含账号或归属表。

AI 后处理：`POST /tasks/:id/llm` 接受 action（polish/summary/translate），要求任务已 SUCCEEDED；需在 `.env` 配置 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`，否则返回 503。翻译目标由识别语言自动决定（中文→英文，其余→中文）。结果写入 `llm_runs` 表，可通过 `GET /tasks/:id/llm` 查询历史。
