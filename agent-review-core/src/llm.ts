import type { LlmCallOptions, LlmCallResult, TokenUsage } from './types.js';

/**
 * Minimal OpenAI-compatible chat completions client.
 *
 * No runtime dependency: uses global fetch (Node >= 18).
 * Works with DeepSeek, OpenAI, OpenRouter and compatible local servers by
 * configuring LLM_BASE_URL / LLM_API_KEY.
 *
 * Adds a per-call timeout and a small automatic retry for transient failures
 * (network errors, 429, 408, 5xx), because a single blip used to abort an
 * entire multi-role review after tokens had already been spent.
 * Tune via LLM_TIMEOUT_MS (default 120000) and LLM_MAX_RETRIES (default 2).
 */

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1000;

function envInt(name: string, fallback: number, allowZero = false): number {
  const raw = Number.parseInt(process.env[name] ?? '', 10);
  const ok = Number.isFinite(raw) && (allowZero ? raw >= 0 : raw > 0);
  return ok ? raw : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface HttpError extends Error {
  status?: number;
}

function isRetryable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status = (error as HttpError).status;
  if (typeof status === 'number') {
    return status === 408 || status === 429 || status >= 500;
  }
  // Network-level failures (fetch TypeError / AbortError / timeouts).
  return (
    error.name === 'AbortError' ||
    error.name === 'TypeError' ||
    /timeout/i.test(error.message)
  );
}

async function postOnce(
  endpoint: string,
  options: LlmCallOptions,
  timeoutMs: number,
): Promise<LlmCallResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model: options.model,
          messages: [
            { role: 'system', content: options.systemPrompt },
            { role: 'user', content: options.userPrompt },
          ],
          max_tokens: options.maxOutputTokens,
          temperature: 0.3,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        const timeoutError = new Error(
          `LLM request timeout after ${timeoutMs}ms`,
        );
        timeoutError.name = 'TimeoutError';
        throw timeoutError;
      }
      throw error;
    }

    if (!response.ok) {
      const text = await response.text();
      const err = new Error(
        `LLM API error ${response.status}: ${text.slice(0, 500)}`,
      ) as HttpError;
      err.status = response.status;
      throw err;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };

    const text = data.choices?.[0]?.message?.content?.trim() ?? '';
    if (!text) {
      throw new Error('LLM API returned empty content');
    }

    const usage: TokenUsage = {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      totalTokens: data.usage?.total_tokens ?? 0,
    };

    return { text, usage };
  } finally {
    clearTimeout(timer);
  }
}

export async function callLlm(options: LlmCallOptions): Promise<LlmCallResult> {
  const endpoint = normalizeEndpoint(options.baseUrl);

  if (!options.apiKey) {
    throw new Error(
      'Missing LLM_API_KEY. Set LLM_API_KEY in environment or use --mock for an offline demo.',
    );
  }

  const timeoutMs = envInt('LLM_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
  const maxRetries = Math.min(
    4,
    envInt('LLM_MAX_RETRIES', DEFAULT_MAX_RETRIES, true),
  );

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_BASE_DELAY_MS * attempt);
    }
    try {
      return await postOnce(endpoint, options, timeoutMs);
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt >= maxRetries) {
        throw error;
      }
    }
  }
  throw lastError;
}

function normalizeEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (trimmed.endsWith('/chat/completions')) return trimmed;
  return `${trimmed}/chat/completions`;
}
