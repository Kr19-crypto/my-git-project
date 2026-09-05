import type { ReviewResult } from './types.js';

/**
 * Build a "next developer instruction" from review Action Items.
 *
 * This is the bridge from review output back into a working/development session:
 * the resulting text can be pasted into a coding session (DSH, IDE, CLI agent)
 * as the next instruction to continue implementation.
 */
export function buildActionPrompt(
  result: ReviewResult,
  options?: {
    includeBlocking?: boolean;
    includeSummary?: boolean;
  },
): string {
  const includeBlocking = options?.includeBlocking ?? false;
  const includeSummary = options?.includeSummary ?? false;

  const lines: string[] = [];
  lines.push('# 下一步开发指令（基于评审 Action Items）');
  lines.push('');

  if (includeSummary && result.summary) {
    lines.push('## 评审结论');
    lines.push(result.summary);
    lines.push('');
  }

  if (includeBlocking && result.blocking.length > 0) {
    lines.push('## 必须修复项（参考）');
    for (const item of result.blocking) lines.push(`- ${item}`);
    lines.push('');
  }

  if (result.action_items.length > 0) {
    lines.push('## 请按以下行动项继续执行');
    result.action_items.forEach((item, index) => {
      lines.push(`${index + 1}. ${item}`);
    });
  } else {
    lines.push('（没有可回灌的行动项）');
  }

  lines.push('');
  lines.push('请逐步处理以上行动项，并在完成后简要说明改动与验证结果。');

  return lines.join('\n');
}
