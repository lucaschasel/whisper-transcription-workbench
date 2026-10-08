export type TaskStatus =
  'QUEUED' | 'RUNNING' | 'CANCEL_REQUESTED' | 'CANCELLED' | 'FAILED' | 'SUCCEEDED';

export type WhisperModel = {
  id: string;
  name: string;
  size: number;
  isDefault: boolean;
};

export type Segment = {
  start: number;
  end: number;
  text: string;
};

export type TaskMetadata = {
  model: string;
  device?: string;
  language?: string;
  elapsedSeconds: number;
  durationSeconds: number;
};

export type Attempt = {
  number: number;
  status: string;
  error?: string;
  started_at: string;
  finished_at?: string;
};

export type TaskEvent = {
  message: string;
  created_at: string;
};

export type TaskSummary = {
  id: string;
  name: string;
  size: number;
  status: TaskStatus;
  stage: string;
  created_at: string;
  updated_at: string;
};

export type TaskDetail = TaskSummary & {
  asset_id: string;
  language: string;
  model: string;
  prompt: string;
  attempt: number;
  error_code?: string;
  error?: string;
  text: string;
  segments: Segment[];
  metadata: TaskMetadata | null;
  attempts: Attempt[];
  events: TaskEvent[];
};

export type WorkerStatus = {
  available: boolean;
  busy: boolean;
  message: string;
};

export type Meta = {
  mode: string;
  personal: boolean;
  maxUploadMB: number;
  models: WhisperModel[];
  defaultModel: string;
};

export type TaskListPage = {
  rows: TaskSummary[];
  total: number;
  page: number;
  counts: { status: string; n: number }[];
};

export type LlmAction = 'polish' | 'summary' | 'translate';

export type LlmRun = {
  id: string;
  action: LlmAction;
  target: string | null;
  result: string;
  created_at: string;
};
