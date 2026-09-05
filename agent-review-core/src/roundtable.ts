import type {
  ReviewRequest,
  ReviewResult,
  Role,
  RoundtableConfig,
  Speech,
  TokenUsage,
} from './types.js';
import { callLlm } from './llm.js';
import { addUsage } from './budget.js';

export type SpeechControl = 'continue' | 'skip' | 'abort';

export interface RunOptions {
  apiKey: string;
  baseUrl: string;
  onSpeech?: (speech: Speech, index: number, total: number) => void;
  /** Optional human-in-the-loop control before each role speaks. */
  beforeSpeech?: (info: {
    round: number;
    roleId: string;
    roleName: string;
    currentIndex: number;
    total: number;
  }) => Promise<SpeechControl | undefined>;
}

const EMPTY_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

/**
 * Run the roundtable. Each role speaks once per round. After the final round,
 * the maintainer (or last role) produces a structured review JSON.
 */
export async function runRoundtable(
  request: ReviewRequest,
  config: RoundtableConfig,
  options: RunOptions,
): Promise<ReviewResult> {
  const transcript: Speech[] = [];
  let usage: TokenUsage = { ...EMPTY_USAGE };
  let truncated = false;
  const totalSpeeches = config.roles.length * config.rounds;
  const summaryReserve = Math.max(0, config.summaryReserveTokens ?? 0);
  const speechBudgetLimit = Math.max(
    0,
    config.budgetLimitTokens - summaryReserve,
  );

  for (let round = 1; round <= config.rounds; round++) {
    for (const role of config.roles) {
      if (usage.totalTokens >= speechBudgetLimit) {
        truncated = true;
        break;
      }

      if (options.beforeSpeech) {
        const control = await options.beforeSpeech({
          round,
          roleId: role.id,
          roleName: role.name,
          currentIndex: transcript.length + 1,
          total: totalSpeeches,
        });
        if (control === 'abort') {
          truncated = true;
          break;
        }
        if (control === 'skip') {
          continue;
        }
      }

        const userPrompt = buildSpeechPrompt(request, role, transcript, round);
        let speech;
        if (config.mock) {
          speech = mockSpeech(role, round);
        } else {
          try {
            speech = await realSpeech(role, round, userPrompt, options);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes('Missing LLM_API_KEY')) throw error;
            speech = {
              roleId: role.id,
              roleName: role.name,
              round,
              content: `[error] ${message}`,
              model: role.model,
              usage: { ...EMPTY_USAGE },
            };
          }
        }
      const nextUsage = addUsage(usage, speech.usage ?? EMPTY_USAGE);
      if (nextUsage.totalTokens > speechBudgetLimit) {
        // Record actual spending, but do not keep the over-budget speech.
        usage = nextUsage;
        truncated = true;
        break;
      }
      usage = nextUsage;
      transcript.push(speech);
      options.onSpeech?.(speech, transcript.length, totalSpeeches);
    }
    if (truncated) break;
  }

  const summarizerRole =
    config.roles.find((role) => role.id === 'maintainer') ??
    config.roles[config.roles.length - 1];

  if (!summarizerRole) {
    throw new Error('No roles configured');
  }

  let summaryText = '';
  const canSummarize =
    transcript.length > 0 && usage.totalTokens < config.budgetLimitTokens;

  if (canSummarize) {
    const summaryPrompt = buildSummaryPrompt(request, transcript);
    if (config.mock) {
      summaryText = mockSummary();
    } else {
      try {
        const summarySpeech = await realSpeech(
          summarizerRole,
          config.rounds + 1,
          summaryPrompt,
          options,
        );
        summaryText = summarySpeech.content;
        usage = addUsage(usage, summarySpeech.usage ?? EMPTY_USAGE);
        if (usage.totalTokens >= config.budgetLimitTokens) {
          truncated = true;
        }
      } catch {
        // If the summary call fails (e.g. budget/network), fall back below.
      }
    }
  } else if (transcript.length > 0) {
    truncated = true;
  }

  // Fallback: if we could not get a structured summary but have transcripts,
  // use the last maintainer/role speech as a readable summary.
  if (!summaryText && transcript.length > 0) {
    const lastMaintainerSpeech = [...transcript]
      .reverse()
      .find((speech) => speech.roleId === 'maintainer');
    summaryText =
      lastMaintainerSpeech?.content ??
      transcript[transcript.length - 1].content;
  }

  return parseReviewResult(summaryText, request, transcript, usage, truncated);
}

async function realSpeech(
  role: Role,
  round: number,
  userPrompt: string,
  options: RunOptions,
): Promise<Speech> {
  const result = await callLlm({
    apiKey: options.apiKey,
    baseUrl: role.baseUrl ?? options.baseUrl,
    model: role.model,
    systemPrompt: role.systemPrompt,
    userPrompt,
    maxOutputTokens: role.maxOutputTokens,
  });
  return {
    roleId: role.id,
    roleName: role.name,
    round,
    content: result.text,
    model: role.model,
    usage: result.usage,
  };
}

function mockSpeech(role: Role, round: number): Speech {
  return {
    roleId: role.id,
    roleName: role.name,
    round,
    content: `[mock] ${role.name} 第 ${round} 轮意见：这是一个离线模拟发言，用于验证流程。`,
    model: role.model,
    usage: { ...EMPTY_USAGE },
  };
}

function mockSummary(): string {
  return JSON.stringify(
    {
      summary: '[mock] 离线模拟评审结论。',
      blocking: ['[mock] 无（示例）'],
      suggestions: ['[mock] 接入真实 LLM 后运行'],
      risks: ['[mock] 当前未做真实分析'],
      action_items: ['[mock] 配置 LLM_API_KEY 后运行真实评审'],
    },
    null,
    2,
  );
}

function buildSpeechPrompt(
  request: ReviewRequest,
  role: Role,
  transcript: Speech[],
  round: number,
): string {
  const parts: string[] = [];
  parts.push(`# Review Task`);
  if (request.task) parts.push(`任务说明：${request.task}`);
  if (request.source) parts.push(`来源：${request.source}`);
  parts.push(`\n## Diff\n\`\`\`diff\n${request.diff}\n\`\`\``);
  if (request.repoContext) {
    parts.push(`\n## Repository Context\n${request.repoContext}`);
  }
  if (transcript.length > 0) {
    parts.push('\n## Previous Discussion');
    for (const speech of transcript) {
      parts.push(`\n[${speech.roleName} / round ${speech.round}]\n${speech.content}`);
    }
  }
  parts.push(
    `\n你是「${role.name}」。现在是第 ${round} 轮。请从你的角色视角给出具体、可执行的评审意见。`,
  );
  return parts.join('\n');
}

function buildSummaryPrompt(
  request: ReviewRequest,
  transcript: Speech[],
): string {
  const discussion = transcript
    .map((s) => `[${s.roleName} / round ${s.round}]\n${s.content}`)
    .join('\n\n');
  return [
    '# Roundtable Transcript',
    request.source ? `来源：${request.source}` : '',
    request.task ? `任务：${request.task}` : '',
    `\n${discussion}`,
    '',
    '请作为最终评审人输出 JSON，格式如下：',
    '{',
    '  "summary": "总体结论",',
    '  "blocking": ["必须修改项"],',
    '  "suggestions": ["建议项"],',
    '  "risks": ["风险"],',
    '  "action_items": ["可直接回灌给开发会话的下一步"]',
    '}',
    '只输出 JSON，不要输出多余文字。',
  ]
    .filter(Boolean)
    .join('\n');
}

function parseReviewResult(
  summaryText: string,
  request: ReviewRequest,
  transcript: Speech[],
  usage: TokenUsage,
  truncated: boolean,
): ReviewResult {
  const fallback: ReviewResult = {
    source: request.source,
    summary: summaryText || '未能生成结构化总结',
    blocking: [],
    suggestions: [],
    risks: [],
    action_items: [],
    transcript,
    truncated,
    usage,
  };

  if (!summaryText) return fallback;

  const jsonText = extractJson(summaryText);
  if (!jsonText) {
    // If the model didn't return JSON, keep the raw text as summary.
    return { ...fallback, summary: summaryText };
  }

  try {
    const parsed = JSON.parse(jsonText) as Partial<ReviewResult>;
    return {
      source: request.source,
      summary: String(parsed.summary ?? fallback.summary),
      blocking: Array.isArray(parsed.blocking) ? parsed.blocking.map(String) : [],
      suggestions: Array.isArray(parsed.suggestions)
        ? parsed.suggestions.map(String)
        : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks.map(String) : [],
      action_items: Array.isArray(parsed.action_items)
        ? parsed.action_items.map(String)
        : [],
      transcript,
      truncated,
      usage,
    };
  } catch {
    return { ...fallback, summary: summaryText };
  }
}

function extractJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return null;
}
