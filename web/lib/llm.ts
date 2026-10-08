export type LlmPreset = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
};

export const LLM_PRESETS: LlmPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  {
    id: 'qwen',
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
  },
  {
    id: 'moonshot',
    name: 'Moonshot Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
  },
];

export type LlmClientConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

const STORAGE_KEY = 'tinglu.llm-config';

export function loadLlmConfig(): LlmClientConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.baseUrl === 'string' &&
      typeof parsed.apiKey === 'string' &&
      typeof parsed.model === 'string'
    )
      return { baseUrl: parsed.baseUrl, apiKey: parsed.apiKey, model: parsed.model };
    return null;
  } catch {
    return null;
  }
}

export function saveLlmConfig(config: LlmClientConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}
