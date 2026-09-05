import type {
  PromptPolishCallOptions,
  PromptPolishFeedback,
  PromptPolishResult,
} from './types.js';
import { callLlm } from './llm.js';

/**
 * "辅助提示词改进" — prompt polish engine.
 *
 * Turns a raw draft (for example a command/terminal development instruction)
 * into structured feedback plus a clearer, more actionable improved prompt.
 * It is deliberately kept as a plain core module so CLI, SDK, and the DSH
 * plugin all share the same prompt rules and model routing.
 */

export const PROMPT_POLISH_SYSTEM_PROMPT = [
  '你是一名资深提示词工程专家。你的任务是对用户给出的“原始提示词/草稿”做“辅助提示词改进”，',
  '既要给出对原始提示词的评审反馈，也要输出改进后的高质量提示词。',
  '',
  '改进时必须遵守：',
  '- 保留用户的原始意图、目标和范围；不要编造用户没有要求的需求或事实。',
  '- 将模糊表述具体化：尽量明确角色、任务、输入、输出、约束、边界条件与验收标准。',
  '- 对命令/终端/开发类任务，明确运行环境、平台、权限、失败处理与验证方式。',
  '- 如果用户已给出附加说明或上下文，必须纳入考虑；不要丢弃有用信息。',
  '- 使用结构化排版（标题/列表/步骤）提升可读性，但不要过度冗长。',
  '',
  '输出必须是单个 JSON 对象，不要输出任何额外文字：',
  '{',
  '  "feedback": {',
  '    "summary": "对原始提示词的总体评价",',
  '    "blocking": ["必须修正的缺陷，例如目标不明、约束缺失、会导致误解或执行失败"],',
  '    "suggestions": ["非阻塞的可改进点"],',
  '    "risks": ["潜在风险或遗漏的边界情况"],',
  '    "action_items": ["可直接执行的改进动作"]',
  '  },',
  '  "text": "改进后的完整提示词"',
  '}',
].join('\n');

export function buildPromptPolishUserMessage(input: {
  text: string;
  instruction?: string;
  context?: string;
}): string {
  const parts: string[] = [];
  if (input.instruction) {
    parts.push(`# 本次改进要求\n${input.instruction}`);
    parts.push('');
  }
  parts.push('# 原始提示词/草稿');
  parts.push(input.text);
  if (input.context) {
    parts.push('');
    parts.push('# 可用上下文/附加说明');
    parts.push(input.context);
  }


  parts.push('');
  parts.push('请按系统提示中的 JSON 格式输出反馈与改进后的提示词。');
  return parts.join('\n');
}

const EMPTY_FEEDBACK: PromptPolishFeedback = {
  summary: '',
  blocking: [],
  suggestions: [],
  risks: [],
  action_items: [],
};

function extractJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function parsePolishResponse(raw: string): {
  text: string;
  feedback: PromptPolishFeedback;
} {
  const jsonText = extractJson(raw);
  if (!jsonText) {
    return { text: raw.trim(), feedback: { ...EMPTY_FEEDBACK } };
  }
  try {
    const parsed = JSON.parse(jsonText) as {
      feedback?: Partial<PromptPolishFeedback>;
      text?: unknown;
    };
    const feedback: PromptPolishFeedback = {
      summary:
        typeof parsed.feedback?.summary === 'string'
          ? parsed.feedback.summary
          : '',
      blocking: stringArray(parsed.feedback?.blocking),
      suggestions: stringArray(parsed.feedback?.suggestions),
      risks: stringArray(parsed.feedback?.risks),
      action_items: stringArray(parsed.feedback?.action_items),
    };
    const text =
      typeof parsed.text === 'string' && parsed.text.trim()
        ? parsed.text.trim()
        : raw.trim();
    return { text, feedback };
  } catch {
    return { text: raw.trim(), feedback: { ...EMPTY_FEEDBACK } };
  }
}


/**
 * Improve a prompt using an OpenAI-compatible LLM.
 */
export async function polishPrompt(
  options: PromptPolishCallOptions,
): Promise<PromptPolishResult> {
  const text = options.text.trim();
  if (!text) {
    throw new Error('polishPrompt requires non-empty prompt text');
  }

  const maxOutputTokens = Math.min(
    8000,
    Math.max(500, options.maxOutputTokens ?? 2000),
  );

  const result = await callLlm({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    model: options.model,
    systemPrompt: PROMPT_POLISH_SYSTEM_PROMPT,
    userPrompt: buildPromptPolishUserMessage({
      text,
      instruction: options.instruction,
      context: options.context,
    }),
    maxOutputTokens,
  });

  const { text: polishedText, feedback } = parsePolishResponse(result.text);

  return {
    text: polishedText,
    originalText: text,
    feedback,
    model: options.model,
    usage: result.usage,
  };
}
