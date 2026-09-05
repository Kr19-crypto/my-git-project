import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { assertReadableDirectory } from './paths.js';

export interface RepoContextOptions {
  root: string;
  maxChars?: number;
}

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  '.next',
  '.turbo',
  'out',
  'build',
  '.cache',
]);

const CONTEXT_FILES = ['README.md', 'README.zh-CN.md', 'README.zh.md', 'package.json'];

/**
 * Load a bounded repository context: a shallow file tree plus short excerpts
 * from common project description files. This gives review roles more context
 * than a raw diff without exploding token usage.
 */
export async function loadRepoContext(
  options: RepoContextOptions,
): Promise<string> {
  const root = await assertReadableDirectory(options.root, 'context root');
  const maxChars = options.maxChars ?? 4000;
  const lines: string[] = [];

  lines.push(`# Repository Context`);
  lines.push(`Root: ${root}`);
  lines.push('');
  lines.push('## File Tree (shallow)');
  lines.push('```text');
  lines.push(...(await collectTree(root, root, 0, 60)));
  lines.push('```');

  for (const name of CONTEXT_FILES) {
    const filePath = join(root, name);
    try {
      const content = await readFile(filePath, 'utf8');
      const trimmed = content.replace(/\s+/g, ' ').trim();
      if (trimmed) {
        lines.push('');
        lines.push(`## ${name} (excerpt)`);
        lines.push(trimmed.slice(0, 800));
      }
    } catch {
      // File not present or unreadable; skip.
    }
  }

  const text = lines.join('\n');
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n... (truncated)` : text;
}

async function collectTree(
  root: string,
  dir: string,
  depth: number,
  maxEntries: number,
): Promise<string[]> {
  if (depth > 2) return [];

  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const output: string[] = [];
  for (const entry of entries) {
    if (output.length >= maxEntries) {
      output.push('... (truncated)');
      break;
    }
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;

    const fullPath = join(dir, entry.name);
    const rel = relative(root, fullPath).replaceAll('\\', '/');
    if (entry.isDirectory()) {
      output.push(`${'  '.repeat(depth)}${rel}/`);
      output.push(...(await collectTree(root, fullPath, depth + 1, maxEntries - output.length)));
    } else {
      output.push(`${'  '.repeat(depth)}${rel}`);
    }
  }
  return output;
}
