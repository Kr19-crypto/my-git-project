import { readFile, readdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { ReviewRequest } from './types.js';

export interface DiffSource {
  repo?: string;
  directory?: string;
  diffFile?: string;
  path?: string;
  task?: string;
  sourceLabel?: string;
}

function gitDiff(repo: string, path?: string): string {
  const args = ['diff', '--no-color', '--'];
  if (path) args.push(path);
  try {
    return execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`git diff failed in ${repo}: ${message}`);
  }
}

// Limits so a huge untracked file set cannot blow up the review context.
const MAX_UNTRACKED_FILES = 30;
const MAX_UNTRACKED_FILE_BYTES = 200_000;
const MAX_UNTRACKED_LINES = 1500;

/**
 * Collect untracked (new, not yet git-added) files of the working tree and
 * render them as pseudo diffs. Without this, reviewing "the current changes"
 * silently misses brand-new files, which is the typical AI-generated-code case.
 */
async function collectUntrackedDiff(
  repo: string,
  path?: string,
): Promise<string> {
  const args = ['ls-files', '--others', '--exclude-standard', '-z', '--'];
  if (path) args.push(path);
  let raw: Buffer;
  try {
    raw = execFileSync('git', args, {
      cwd: repo,
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch {
    return '';
  }
  const names = raw
    .toString('utf8')
    .split('\0')
    .filter((name) => name.length > 0);
  if (names.length === 0) return '';

  const chunks: string[] = [];
  let emitted = 0;
  for (const rel of names) {
    if (emitted >= MAX_UNTRACKED_FILES) {
      chunks.push(`# ... (${names.length - emitted} more untracked files omitted)`);
      break;
    }
    const full = join(repo, rel);
    let info;
    try {
      info = await stat(full);
    } catch {
      continue; // vanished between listing and reading
    }
    if (!info.isFile() || info.size > MAX_UNTRACKED_FILE_BYTES) continue;

    let content: string;
    try {
      content = await readFile(full, 'utf8');
    } catch {
      continue; // unreadable/binary file; skip silently
    }
    if (content.includes('\0')) continue; // binary

    const lines = content.split(/\r?\n/);
    if (lines.length > MAX_UNTRACKED_LINES) {
      lines.length = MAX_UNTRACKED_LINES;
    }
    const safe = rel.replaceAll('\\', '/');
    const body = lines.map((line) => `+${line}`).join('\n');
    chunks.push(
      [
        `diff --git a/${safe} b/${safe}`,
        'new file mode 100644',
        `--- /dev/null`,
        `+++ b/${safe}`,
        `@@ -0,0 +1,${lines.length} @@`,
        body,
        '',
      ].join('\n'),
    );
    emitted++;
  }
  return chunks.join('\n');
}


const DIRECTORY_IGNORES = new Set([
  '.git', 'node_modules', 'dist', 'build', '.next', '.turbo', 'coverage', '.cache', 'out',
  'venv', '.venv', 'venv-ml', 'env', '.env', 'data', 'logs', 'archive', 'backup',
  '__pycache__', 'site-packages', '.idea', '.vscode', '.pytest_cache', '.mypy_cache',
]);
const DIRECTORY_ALLOW_EXT = new Set([
  '.py', '.js', '.ts', '.tsx', '.jsx', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.rb', '.php',
  '.lua', '.sh', '.bash', '.ps1', '.json', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.md', '.txt', '.html',
  '.css', '.scss', '.vue', '.svelte', '.sql',
]);
const DIRECTORY_MAX_FILES = 6;
const DIRECTORY_MAX_FILE_BYTES = 40_000;
const DIRECTORY_MAX_LINES = 400;

async function listDirectoryFiles(dir: string, base: string = dir): Promise<string[]> {
  const output: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return output;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
    if (entry.isDirectory()) {
      if (DIRECTORY_IGNORES.has(entry.name)) continue;
      output.push(...(await listDirectoryFiles(join(dir, entry.name), base)));
    } else if (entry.isFile()) {
      output.push(join(dir, entry.name));
    }
  }
  return output;
}

async function collectDirectoryDiff(directory: string): Promise<string> {
  const files = await listDirectoryFiles(directory);
  files.sort();
  const chunks: string[] = [];
  let emitted = 0;

  for (const full of files) {
    if (emitted >= DIRECTORY_MAX_FILES) {
      chunks.push(`# ... (${files.length - emitted} more files omitted)`);
      break;
    }
    const rel = full.slice(directory.length).replace(/^[/\\]+/, '').replaceAll('\\', '/');
    if (!rel) continue;
    let info;
    try { info = await stat(full); } catch { continue; }
    if (!info.isFile() || info.size > DIRECTORY_MAX_FILE_BYTES) continue;
    let content: string;
    try { content = await readFile(full, 'utf8'); } catch { continue; }
    if (content.includes('\0')) continue;

    const lines = content.split(/\r?\n/);
    if (lines.length > DIRECTORY_MAX_LINES) lines.length = DIRECTORY_MAX_LINES;
    const body = lines.map((line) => `+${line}`).join('\n');
    chunks.push(
      [
        `diff --git a/${rel} b/${rel}`,
        'new file mode 100644',
        '--- /dev/null',
        `+++ b/${rel}`,
        `@@ -0,0 +1,${lines.length} @@`,
        body,
        '',
      ].join('\n'),
    );
    emitted++;
  }
  return chunks.join('\n');
}

export async function loadDiff(source: DiffSource): Promise<ReviewRequest> {
  let diff = '';

  if (source.diffFile) {
    diff = await readFile(source.diffFile, 'utf8');
  } else if (source.repo) {
    diff = gitDiff(source.repo, source.path);
    const untracked = await collectUntrackedDiff(source.repo, source.path);
    if (untracked) {
      diff = diff ? `${diff}\n${untracked}` : untracked;
    }
  } else if (source.directory) {
    diff = await collectDirectoryDiff(source.directory);
  } else {
    throw new Error('Must provide --repo, --directory, or --diff-file');
  }

  if (!diff.trim()) {
    throw new Error('Diff is empty. Provide a repo with changes or a diff file.');
  }

  return {
    diff,
    task: source.task,
    source: source.sourceLabel ?? source.repo ?? source.directory ?? source.diffFile,
  };
}
