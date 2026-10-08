export type LlmAction = 'polish' | 'summary' | 'translate';

export type LlmConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export function normalizeConfig(
  input?: { baseUrl?: string; apiKey?: string; model?: string } | null,
): LlmConfig | null {
  if (!input) return null;
  const baseUrl = (input.baseUrl || '').trim().replace(/\/+$/, '');
  const apiKey = (input.apiKey || '').trim();
  const model = (input.model || '').trim();
  if (!baseUrl || !apiKey || !model) return null;
  return { baseUrl, apiKey, model };
}

export function llmConfig(): LlmConfig | null {
  return normalizeConfig({
    baseUrl: process.env.LLM_BASE_URL,
    apiKey: process.env.LLM_API_KEY,
    model: process.env.LLM_MODEL,
  });
}

const PROMPTS: Record<LlmAction, (text: string, target?: string) => string> = {
  polish: (text) =>
    [
      '你是一名专业的字幕校对员。请把下面的语音转写文本润色为书面语字幕：',
      '- 修正口语冗余、重复和明显口误，保留原意和关键信息',
      '- 保留原文的分段结构，每段一行',
      '- 不要添加转写中不存在的任何内容',
      '- 直接输出润色后的文本，不要任何解释',
      '',
      `原文：\n${text}`,
    ].join('\n'),
  summary: (text) =>
    [
      '请为下面的语音转写内容生成摘要：',
      '- 用简洁的中文概括主要内容（约 150 到 250 字）',
      '- 再列出 3 到 6 个关键要点',
      '- 直接输出，不要解释',
      '',
      `原文：\n${text}`,
    ].join('\n'),
  translate: (text, target) =>
    [
      `请把下面的文本翻译成${target === 'en' ? '英文' : '中文'}：`,
      '- 保持原意和语气',
      '- 直接输出翻译结果，不要解释',
      '',
      `原文：\n${text}`,
    ].join('\n'),
};

// 输入过长时截断，避免超出模型上下文。
const MAX_INPUT_CHARS = 12000;

export async function runLlm(
  config: LlmConfig,
  action: LlmAction,
  text: string,
  target?: string,
): Promise<string> {
  const truncated = text.length > MAX_INPUT_CHARS;
  const input = truncated ? text.slice(0, MAX_INPUT_CHARS) + '\n…（原文过长，已截断）' : text;
  const prompt = PROMPTS[action](input, target);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.LLM_TIMEOUT_MS || 120000));
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `LLM 服务返回 ${response.status}${detail ? `：${detail.slice(0, 300)}` : ''}`,
      );
    }
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('LLM 返回内容为空，请重试。');
    }
    return content.trim();
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw new Error('LLM 请求超时，请重试或缩短文本。');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// 翻译方向：源语言为中文时翻成英文，否则翻成中文。
export function translateTarget(language?: string): 'en' | 'zh' {
  return language === 'zh' ? 'en' : 'zh';
}
