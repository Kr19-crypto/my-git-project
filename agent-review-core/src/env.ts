import { readFile } from 'node:fs/promises';

/**
 * Load `.env` from the package root without adding a dependency.
 *
 * Works both from `src/` during tsx development and from `dist/` after build:
 * `import.meta.url` points to the current module, so `../.env` resolves to the
 * package root (`agent-review-core/.env`).
 *
 * Existing process environment variables always win; this only fills missing
 * values.
 */
export async function loadProjectEnv(): Promise<void> {
  const envUrl = new URL('../.env', import.meta.url);
  try {
    const content = await readFile(envUrl, 'utf8');
    applyDotEnv(content);
  } catch {
    // No .env file present; keep using existing process env.
  }
}

export function applyDotEnv(content: string): void {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
