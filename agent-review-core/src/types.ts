/**
 * Core types for Agent Review Roundtable.
 *
 * This file intentionally has no runtime dependencies so it can be reused by
 * a future DSH plugin adapter or an IDE adapter.
 */

export type RoleId = string;

export interface Role {
  /** Stable id, e.g. "architect". */
  id: RoleId;
  /** Human-readable name shown in UI/logs. */
  name: string;
  /** Short description of the role's mission. */
  description: string;
  /** System prompt given to the model for this role. */
  systemPrompt: string;
  /** Model id. May be a high-cost or low-cost model depending on role. */
  model: string;
  /** Model tier used for environment-based routing: core = high-performance, aux = low-cost. */
  /** Optional provider base URL for this role. Defaults to the global base URL. */
  baseUrl?: string;
  tier?: 'core' | 'aux';
  /** Max output tokens for this role per speech. */
  maxOutputTokens: number;
  /** Weight used by the rough token/cost estimator. */
  weight?: number;
}

export interface ReviewRequest {
  /** Raw diff/patch text. */
  diff: string;
  /** Optional task description from the user. */
  task?: string;
  /** Optional repository context summary (file list, architecture notes). */
  repoContext?: string;
  /** Optional source label, e.g. "dsh-aurora-wallpaper working tree". */
  source?: string;
}

export interface RoundtableConfig {
  roles: Role[];
  /** Number of discussion rounds. Each role speaks once per round. */
  rounds: number;
  /** Hard token budget for the whole review. */
  budgetLimitTokens: number;
  /**
   * Tokens reserved for the final structured summary call.
   * Role speeches stop when they reach budgetLimitTokens - summaryReserveTokens.
   * Defaults to 0 if not provided.
   */
  summaryReserveTokens?: number;
  /** If true, run without real LLM calls and return canned speeches. */
  mock?: boolean;
}

export interface Speech {
  roleId: RoleId;
  roleName: string;
  round: number;
  content: string;
  model?: string;
  /** Token usage for this single LLM call, when available. */
  usage?: TokenUsage;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ReviewResult {
  source?: string;
  summary: string;
  blocking: string[];
  suggestions: string[];
  risks: string[];
  action_items: string[];
  transcript: Speech[];
  truncated: boolean;
  usage: TokenUsage;
}

export interface CostEstimate {
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedTotalTokens: number;
  roles: Array<{
    roleId: RoleId;
    estimatedTokens: number;
  }>;
}

export interface LlmCallOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens: number;
}

export interface LlmCallResult {
  text: string;
  usage: TokenUsage;
}
