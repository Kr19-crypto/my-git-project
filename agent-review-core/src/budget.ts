import type { CostEstimate, ReviewRequest, Role, TokenUsage } from './types.js';

/**
 * Rough token estimator. Good enough for an up-front warning.
 * A more precise per-model tokenizer can replace this later.
 */
export function roughTokens(text: string): number {
  if (!text) return 0;
  // Very rough: ~4 chars per token for English/code, CJK chars are heavier.
  // For a demo warning this is acceptable; later replace with a real tokenizer.
  return Math.ceil(text.length / 3);
}

export function estimateCost(
  request: ReviewRequest,
  roles: Role[],
  rounds: number,
): CostEstimate {
  const baseContext = roughTokens(
    [
      request.task ?? '',
      request.repoContext ?? '',
      request.source ?? '',
    ].join('\n'),
  );
  const diffTokens = roughTokens(request.diff);

  const perRole = roles.map((role) => {
    const systemTokens = roughTokens(role.systemPrompt);
    // Each round the role sees the diff + prior transcript. We approximate by
    // charging baseContext + diff + system once per round.
    const perRoundInput = systemTokens + baseContext + diffTokens;
    const output = role.maxOutputTokens;
    const estimatedTokens = (perRoundInput + output) * rounds * (role.weight ?? 1);
    return {
      roleId: role.id,
      estimatedTokens,
    };
  });

  const estimatedTotalTokens = perRole.reduce((sum, item) => sum + item.estimatedTokens, 0);
  const estimatedOutputTokens = roles.reduce(
    (sum, role) => sum + role.maxOutputTokens * rounds,
    0,
  );

  return {
    estimatedInputTokens: estimatedTotalTokens - estimatedOutputTokens,
    estimatedOutputTokens,
    estimatedTotalTokens,
    roles: perRole,
  };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

export function formatBudgetWarning(
  estimate: CostEstimate,
  budgetLimitTokens: number,
): string {
  const line = [
    '=== Token 预算预估 ===',
    `预计总消耗：约 ${estimate.estimatedTotalTokens.toLocaleString()} tokens`,
    `当前硬上限：${budgetLimitTokens.toLocaleString()} tokens`,
    estimate.estimatedTotalTokens > budgetLimitTokens
      ? '⚠️ 预计会超过上限，请降低轮次/角色或增大预算。'
      : '✅ 预计在上限以内。',
    '',
  ];
  for (const role of estimate.roles) {
    line.push(`- ${role.roleId}: 约 ${role.estimatedTokens.toLocaleString()} tokens`);
  }
  return line.join('\n');
}
