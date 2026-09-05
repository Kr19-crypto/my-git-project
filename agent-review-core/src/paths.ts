import { realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

/**
 * Path safety helpers for CLI/context operations.
 *
 * The CLI is a local developer tool, but it can be driven by LLM agents,
 * so file reads/writes should still stay within an explicit allowed root
 * whenever possible. This prevents accidental `--output ../...` writes and
 * makes the tool's filesystem surface more predictable.
 */

export function isPathInside(base: string, candidate: string): boolean {
  const from = resolve(base);
  const to = resolve(candidate);
  const rel = relative(from, to);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Lexical containment check; returns the resolved candidate path.
 * Does not require the path to exist.
 */
export function assertPathInside(
  base: string,
  candidate: string,
  label = 'path',
): string {
  const resolved = resolve(candidate);
  if (!isPathInside(base, resolved)) {
    throw new Error(
      `${label} path escapes allowed directory (${resolve(base)}): ${resolved}`,
    );
  }
  return resolved;
}

/**
 * Resolve a directory and ensure it exists and is actually a directory.
 * Returns the real path so symlinked/.. segments are canonicalized.
 */
export async function assertReadableDirectory(
  input: string,
  label = 'directory',
): Promise<string> {
  const resolved = resolve(input);
  let info;
  try {
    info = await stat(resolved);
  } catch {
    throw new Error(`${label} does not exist or is not readable: ${resolved}`);
  }
  if (!info.isDirectory()) {
    throw new Error(`${label} must be a directory: ${resolved}`);
  }
  return realpath(resolved);
}

/**
 * Validate a write target before creating a report/backfeed file.
 * The resolved target (and its existing parent directory) must remain
 * inside the allowed base directory.
 */
export async function assertSafeOutputPath(
  input: string,
  base = process.cwd(),
  label = 'output',
): Promise<string> {
  const baseReal = await realpath(resolve(base));
  const resolved = resolve(input);
  const parent = dirname(resolved);

  if (!isPathInside(baseReal, parent)) {
    throw new Error(
      `${label} path escapes allowed directory (${baseReal}): ${resolved}`,
    );
  }

  let parentReal: string;
  try {
    parentReal = await realpath(parent);
  } catch {
    parentReal = parent;
  }
  if (!isPathInside(baseReal, parentReal)) {
    throw new Error(
      `${label} path escapes allowed directory through symlink (${baseReal}): ${resolved}`,
    );
  }

  return resolved;
}
