import type { ReviewResult } from './types.js';

/**
 * Render a review result as Markdown. The output is intended to be readable
 * both as a standalone report and as a section in a project document.
 */
export function renderMarkdownReview(
  result: ReviewResult,
  meta?: {
    rounds?: number;
    budgetLimitTokens?: number;
    roles?: string[];
  },
): string {
  const lines: string[] = [];

  lines.push('# Review Report');
  lines.push('');
  if (result.source) lines.push(`> Source: \`${result.source}\``);
  if (meta?.roles?.length) {
    lines.push(`> Roles: ${meta.roles.join(', ')}`);
  }
  if (meta?.rounds) lines.push(`> Rounds: ${meta.rounds}`);
  if (meta?.budgetLimitTokens) {
    lines.push(`> Token Budget: ${meta.budgetLimitTokens.toLocaleString()}`);
  }
  lines.push(
    `> Usage: ${result.usage.totalTokens.toLocaleString()} tokens ` +
      `(${result.usage.inputTokens.toLocaleString()} in / ${result.usage.outputTokens.toLocaleString()} out)`,
  );
  lines.push(`> Truncated: ${result.truncated ? 'true' : 'false'}`);
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push(result.summary || '（未生成总结）');
  lines.push('');

  lines.push('## Blocking');
  lines.push('');
  if (result.blocking.length === 0) {
    lines.push('_无_');
  } else {
    result.blocking.forEach((item) => lines.push(`- ${item}`));
  }
  lines.push('');

  lines.push('## Suggestions');
  lines.push('');
  if (result.suggestions.length === 0) {
    lines.push('_无_');
  } else {
    result.suggestions.forEach((item) => lines.push(`- ${item}`));
  }
  lines.push('');

  lines.push('## Risks');
  lines.push('');
  if (result.risks.length === 0) {
    lines.push('_无_');
  } else {
    result.risks.forEach((item) => lines.push(`- ${item}`));
  }
  lines.push('');

  lines.push('## Action Items');
  lines.push('');
  if (result.action_items.length === 0) {
    lines.push('_无_');
  } else {
    result.action_items.forEach((item) => lines.push(`- [ ] ${item}`));
  }
  lines.push('');

  if (result.transcript.length > 0) {
    lines.push('## Discussion Transcript');
    lines.push('');
    for (const speech of result.transcript) {
      lines.push(`### ${speech.roleName} (round ${speech.round})`);
      lines.push('');
      lines.push(speech.content);
      lines.push('');
    }
  }

  return lines.join('\n');
}
