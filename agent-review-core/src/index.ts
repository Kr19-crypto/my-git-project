/**
 * Agent Review Roundtable — public SDK entry.
 *
 * Import from the package as:
 *
 *   import { runRoundtable, buildActionPrompt } from 'agent-review-roundtable/sdk'
 *
 * This entry is independent from the DSH plugin host entry (`dsh/index.js`).
 */

// Types
export type {
  Role,
  ReviewRequest,
  RoundtableConfig,
  Speech,
  TokenUsage,
  ReviewResult,
  CostEstimate,
  LlmCallOptions,
  LlmCallResult,
} from './types.js';

// Defaults & config
export { DEFAULT_ROLES, getDefaultRoles } from './defaultRoles.js';
export { applyRoleModelRouting, createConfig, loadRoles } from './config.js';

// Environment / inputs
export { loadProjectEnv } from './env.js';
export { loadDiff } from './diff.js';
export { loadRepoContext } from './context.js';

// Budget & reporting
export { roughTokens, estimateCost, formatBudgetWarning } from './budget.js';
export { renderMarkdownReview } from './report.js';

// Roundtable engine
export { runRoundtable } from './roundtable.js';

// Action Items backfeed
export { buildActionPrompt } from './actions.js';
