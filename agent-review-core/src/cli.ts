#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';
import { readFile, writeFile } from 'node:fs/promises';
import { applyRoleModelRouting, createConfig, loadRoles } from './config.js';
import { assertReadableDirectory, assertSafeOutputPath } from './paths.js';
import { loadDiff } from './diff.js';
import { loadRepoContext } from './context.js';
import { estimateCost, formatBudgetWarning } from './budget.js';
import { runRoundtable } from './roundtable.js';
import { renderMarkdownReview } from './report.js';
import { buildActionPrompt } from './actions.js';
import { polishPrompt } from './promptPolish.js';
import { loadProjectEnv } from './env.js';
import type { ReviewRequest } from './types.js';

const USAGE = `
Usage:
  agent-review review --repo <path> [options]
  agent-review review --diff-file <file.patch> [options]
  agent-review mock --repo <path> [options]
  agent-review next --result <review.json> [options]
  agent-review polish --prompt <text> [options]

Options:
  --prompt <text>        Prompt/draft text to improve (polish command)
  --prompt-file <file>   Read prompt text from a UTF-8 file (polish command)
  --instruction <text>   Optional extra instruction for polish command
  --context <text>       Optional context/constraints for polish command
  --feedback             Print structured prompt feedback (polish command)
  --repo <path>          Local git repository path
  --directory <path>     Review a non-git directory (snapshot pseudo-diff)
  --diff-file <path>     Read diff from a file instead of git
  --path <file>          Limit git diff to one path
    --context-dir <path>   Load repository context from a directory
    --no-context           Disable automatic repository context
  --task <text>          Optional task description
  --rounds <number>      Rounds (default: 2)
  --budget <number>      Hard token budget (default: 100000)
  --roles <json>         Optional roles JSON file with { "roles": [...] }
  --output <file.md>     Write Markdown report to a file
    --output-json <file.json>  Write JSON result to a file (UTF-8)
    --write-back <file.txt>  Write Action Items backfeed prompt to a file
    --interactive            Pause before each role speech for human control
  --json                 Print result as JSON to stdout
  --result <review.json>  Read a saved review JSON for next command
  --include-blocking      Include blocking items in the backfeed prompt
  --include-summary       Include summary in the backfeed prompt
  --yes                  Skip confirmation
  --mock                 Run offline with canned speeches
  --help                 Show help
`;

interface ParsedArgs {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
}


async function runNextCommand(
  values: Record<string, string | boolean | undefined>,
): Promise<void> {
  const resultFile = typeof values.result === 'string' ? values.result : undefined;
  if (!resultFile) {
    console.error('next command requires --result <review.json>');
    process.exit(1);
  }

  const raw = await readFile(resultFile, 'utf8');
  const result = JSON.parse(raw) as import('./types.js').ReviewResult;
  const prompt = buildActionPrompt(result, {
    includeBlocking: values['include-blocking'] === true,
    includeSummary: values['include-summary'] === true,
  });

  const outputFile = typeof values.output === 'string' ? values.output : undefined;
  if (outputFile) {
    const outputPath = await assertSafeOutputPath(outputFile, process.cwd(), '--output');
    await writeFile(outputPath, prompt, 'utf8');
    console.log(`Action prompt written to: ${outputPath}`);
  } else {
    console.log(prompt);
  }
}

function printPromptPolishFeedback(
  result: import('./types.js').PromptPolishResult,
): void {
  const feedback = result.feedback;
  console.log('\n=== Prompt Feedback ===');
  if (feedback.summary) console.log(feedback.summary);
  if (feedback.blocking.length > 0) {
    console.log('\nBlocking:');
    feedback.blocking.forEach((item) => console.log(`- ${item}`));
  }
  if (feedback.suggestions.length > 0) {
    console.log('\nSuggestions:');
    feedback.suggestions.forEach((item) => console.log(`- ${item}`));
  }
  if (feedback.risks.length > 0) {
    console.log('\nRisks:');
    feedback.risks.forEach((item) => console.log(`- ${item}`));
  }
  if (feedback.action_items.length > 0) {
    console.log('\nAction Items:');
    feedback.action_items.forEach((item, index) => console.log(`${index + 1}. ${item}`));
  }
}


async function runPolishCommand(
  values: Record<string, string | boolean | undefined>,
): Promise<void> {
  const promptText =
    typeof values.prompt === 'string' ? values.prompt.trim() : '';
  const promptFile =
    typeof values['prompt-file'] === 'string' ? values['prompt-file'] : undefined;

  let text = promptText;
  if (promptFile) {
    text = (await readFile(promptFile, 'utf8')).trim();
  }
  if (!text) {
    console.error('polish command requires --prompt <text> or --prompt-file <file>');
    process.exit(1);
  }

  const apiKey = process.env.LLM_API_KEY ?? '';
  const baseUrl = process.env.LLM_BASE_URL ?? 'https://api.deepseek.com/v1';
  const model =
    process.env.LLM_PROMPT_MODEL ??
    process.env.LLM_CORE_MODEL ??
    'deepseek-chat';
  const instruction =
    typeof values.instruction === 'string' ? values.instruction : undefined;
  const context =
    typeof values.context === 'string' ? values.context : undefined;

  const result = await polishPrompt({
    text,
    instruction,
    context,
    apiKey,
    baseUrl,
    model,
  });

  if (values.feedback === true && values.json !== true) {
    printPromptPolishFeedback(result);
  }

  const outputFile =
    typeof values.output === 'string' ? values.output : undefined;
  const outputJson =
    typeof values['output-json'] === 'string' ? values['output-json'] : undefined;

  if (outputJson) {
    const outputJsonPath = await assertSafeOutputPath(
      outputJson,
      process.cwd(),
      '--output-json',
    );
    await writeFile(outputJsonPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    if (values.json !== true) {
      console.log(`Polished JSON written to: ${outputJsonPath}`);
    }
  }

  if (values.json === true) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (outputFile) {
    const outputPath = await assertSafeOutputPath(
      outputFile,
      process.cwd(),
      '--output',
    );
    await writeFile(outputPath, `${result.text}\n`, 'utf8');
    console.log(`Polished prompt written to: ${outputPath}`);
  } else if (!outputJson) {
    console.log(result.text);
  }
}


export async function main(): Promise<void> {
  await loadProjectEnv();

  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      repo: { type: 'string' },
        directory: { type: 'string' },
      'diff-file': { type: 'string' },
      path: { type: 'string' },
        'context-dir': { type: 'string' },
        'no-context': { type: 'boolean', default: false },
      task: { type: 'string' },
      rounds: { type: 'string' },
      budget: { type: 'string' },
      roles: { type: 'string' },
        output: { type: 'string' },
        'output-json': { type: 'string' },
        'write-back': { type: 'string' },
        interactive: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        result: { type: 'string' },
        'include-blocking': { type: 'boolean', default: false },
        'include-summary': { type: 'boolean', default: false },
      prompt: { type: 'string' },
      'prompt-file': { type: 'string' },
      instruction: { type: 'string' },
      context: { type: 'string' },
      feedback: { type: 'boolean', default: false },
      yes: { type: 'boolean', default: false },
      mock: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: false,
  }) as ParsedArgs;

  if (values.help || positionals.length === 0) {
    console.log(USAGE);
    return;
  }

  const command = positionals[0];
  if (
    command !== 'review' &&
    command !== 'mock' &&
    command !== 'next' &&
    command !== 'polish'
  ) {
    console.error(`Unknown command: ${command}`);
    console.error(USAGE);
    process.exit(1);
  }

  if (command === 'next') {
    await runNextCommand(values);
    return;
  }

  if (command === 'polish') {
    await runPolishCommand(values);
    return;
  }

  const repo = typeof values.repo === 'string' ? values.repo : undefined;
    const directory =
      typeof values.directory === 'string' ? values.directory : undefined;
  const diffFile =
    typeof values['diff-file'] === 'string' ? values['diff-file'] : undefined;
  const path = typeof values.path === 'string' ? values.path : undefined;
    const contextDir =
      typeof values['context-dir'] === 'string' ? values['context-dir'] : undefined;
    const noContext = values['no-context'] === true;
  const task = typeof values.task === 'string' ? values.task : undefined;
  const rounds = numberValue(values.rounds, 2, 1, 5);
  const budgetLimitTokens = numberValue(values.budget, 100_000, 1_000, 5_000_000);
  const mock = command === 'mock' || values.mock === true;
  const rolesConfig = typeof values.roles === 'string' ? values.roles : undefined;
    const output =
      typeof values.output === 'string' ? values.output : undefined;
    const outputJson =
      typeof values['output-json'] === 'string' ? values['output-json'] : undefined;
    const writeBack =
      typeof values['write-back'] === 'string' ? values['write-back'] : undefined;
    const interactive = values.interactive === true;
  const jsonMode = values.json === true;
  const log = jsonMode
    ? console.error.bind(console)
    : console.log.bind(console);

  const safeOutput = output ? await assertSafeOutputPath(output, process.cwd(), '--output') : undefined;
  const safeOutputJson = outputJson ? await assertSafeOutputPath(outputJson, process.cwd(), '--output-json') : undefined;
  const safeWriteBack = writeBack ? await assertSafeOutputPath(writeBack, process.cwd(), '--write-back') : undefined;
  const loadedRoles = await loadRoles(rolesConfig);
  const roles = applyRoleModelRouting(loadedRoles);
  const config = createConfig(
    {
      repo,
      diffFile,
      path,
      task,
      rounds,
      budgetLimitTokens,
      mock,
      yes: values.yes === true,
      rolesConfig,
    },
    roles,
  );

  const request: ReviewRequest = await loadDiff({ repo, directory, diffFile, path, task });
  if (!noContext) {
    const rawContextRoot = contextDir ?? (repo ? repo : directory ? directory : undefined);
    if (rawContextRoot) {
      const contextRoot = contextDir
        ? await assertReadableDirectory(contextDir, '--context-dir')
        : rawContextRoot;
      request.repoContext = await loadRepoContext({ root: contextRoot });
      log(`Context loaded from: ${contextRoot}`);
    }
  }
  const estimate = estimateCost(request, roles, rounds);
  log('=== Agent Review Roundtable ===');
  log(`Source: ${request.source ?? 'unknown'}`);
  log(`Roles: ${roles.map((r) => r.id).join(', ')}`);
  log(`Rounds: ${rounds}`);
  log('');
  log(formatBudgetWarning(estimate, budgetLimitTokens));
  log('');

  if (!values.yes) {
    const proceed = await askYesNo('Start review? [y/N] ');
    if (!proceed) {
      log('Cancelled.');
      return;
    }
  }

  const apiKey = process.env.LLM_API_KEY ?? '';
  const baseUrl = process.env.LLM_BASE_URL ?? 'https://api.deepseek.com/v1';

  const startedAt = Date.now();
  const result = await runRoundtable(request, config, {
    apiKey,
    baseUrl,
    onSpeech(speech, index, total) {
      log(`[${index}/${total}] ${speech.roleName} (round ${speech.round})`);
    },
    async beforeSpeech(info) {
      if (!interactive) return 'continue';
      log(`\n--- 即将发言：${info.roleName} (round ${info.round}) ---`);
      const choice = await askControl(
        'Enter=继续, S=跳过该角色, A=中止评审',
      );
      return choice;
    },
  });
  const elapsedMs = Date.now() - startedAt;

    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      printResult(result, elapsedMs);
    }

    if (output) {
      const markdown = renderMarkdownReview(result, {
        rounds,
        budgetLimitTokens,
        roles: roles.map((role) => role.id),
      });
      const outputPath = safeOutput as string;
      await writeFile(outputPath, markdown, 'utf8');
      log(`\nMarkdown report written to: ${outputPath}`);
    }

    if (outputJson) {
      const outputJsonPath = safeOutputJson as string;
      await writeFile(outputJsonPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
      log(`\nJSON report written to: ${outputJsonPath}`);
    }

    if (writeBack) {
      const backfeed = buildActionPrompt(result, {
        includeBlocking: true,
        includeSummary: true,
      });
      const backfeedPath = safeWriteBack as string;
      await writeFile(backfeedPath, backfeed, 'utf8');
      log(`\nAction Items backfeed written to: ${backfeedPath}`);
    }
}

function printResult(
  result: import('./types.js').ReviewResult,
  elapsedMs: number,
): void {
  console.log('\n=== Review Result ===');
  console.log(`Summary: ${result.summary}`);
  console.log('\nBlocking:');
  for (const item of result.blocking) console.log(`- ${item}`);
  console.log('\nSuggestions:');
  for (const item of result.suggestions) console.log(`- ${item}`);
  console.log('\nRisks:');
  for (const item of result.risks) console.log(`- ${item}`);
  console.log('\nAction Items:');
  for (const item of result.action_items) console.log(`- ${item}`);
  console.log(`\nTruncated: ${result.truncated}`);
  console.log(
    `Usage: ${result.usage.totalTokens.toLocaleString()} tokens ` +
      `(${result.usage.inputTokens.toLocaleString()} in / ${result.usage.outputTokens.toLocaleString()} out)`,
  );
  console.log(`Elapsed: ${(elapsedMs / 1000).toFixed(1)}s`);
}

function numberValue(
  value: string | boolean | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== 'string') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function askYesNo(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y|yes|true$/i.test(answer.trim()));
    });
  });
}

function askControl(question: string): Promise<'continue' | 'skip' | 'abort'> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question + ' ', (answer) => {
      rl.close();
      const value = answer.trim().toLowerCase();
      if (value === 's' || value === 'skip') resolve('skip');
      else if (value === 'a' || value === 'abort') resolve('abort');
      else resolve('continue');
    });
  });
}


main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
