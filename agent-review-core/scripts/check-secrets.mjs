import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const scanRoot = join(here, '..', '..')

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  '.tmp',
  '.pytest_cache',
  '.ruff_cache',
  '__pycache__',
  'venv',
  'venv-ml',
])

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bghp_[A-Za-z0-9]{30,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /-----BEGIN (?:RSA|OPENSSH|EC|DSA) PRIVATE KEY-----/,
  /(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'][A-Za-z0-9_\-./+=]{24,}["']/i,
]

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      files.push(...(await listFiles(join(dir, entry.name))))
    } else if (entry.isFile()) {
      files.push(join(dir, entry.name))
    }
  }
  return files
}

const findings = []
for (const file of await listFiles(scanRoot)) {
  let text
  try {
    const content = await readFile(file)
    if (content.includes(0)) continue
    text = content.toString('utf8')
  } catch {
    continue
  }
  for (const pattern of SECRET_PATTERNS) {
    const m = text.match(pattern)
    if (m) {
      findings.push(`${relative(scanRoot, file)}: ${pattern}`)
    }
  }
}

if (findings.length > 0) {
  console.error('Potential secrets found:')
  for (const finding of findings) console.error(`- ${finding}`)
  process.exit(1)
}

console.log('Secret scan OK')
