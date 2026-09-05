import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const coreRoot = join(here, '..', '..')
const cliPath = join(coreRoot, 'dist', 'cli.js')
const samplePatch = join(coreRoot, 'samples', 'aurora.patch')

function runCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: coreRoot,
    encoding: 'utf8',
    timeout: 30000,
  })
}

function requireSpawn(t, res) {
  if (!res.error) return true
  if (/EPERM|EACCES/.test(res.error.message)) {
    t.skip(`child process spawn is blocked in this sandbox: ${res.error.message}`)
    return false
  }
  assert.fail(res.error.message)
}

test('CLI mock command can review a temporary directory', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'art-cli-dir-'))
  try {
    await writeFile(join(dir, 'sample.py'), 'print("hello")\n', 'utf8')
    const res = runCli(['mock', '--directory', dir, '--rounds', '1', '--json', '--yes'])
    if (!requireSpawn(t, res)) return
    assert.equal(res.status, 0, res.stderr)
    const parsed = JSON.parse(res.stdout)
    assert.match(parsed.summary, /mock/i)
    assert.ok(Array.isArray(parsed.action_items))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CLI mock command can review an existing sample patch', async (t) => {
  const res = runCli(['mock', '--diff-file', samplePatch, '--rounds', '1', '--json', '--yes'])
  if (!requireSpawn(t, res)) return
  assert.equal(res.status, 0, res.stderr)
  const parsed = JSON.parse(res.stdout)
  assert.match(parsed.summary, /mock/i)
  assert.ok(parsed.transcript.length > 0)
})

test('sample review JSON reports remain parseable and structurally valid', async () => {
  for (const name of ['aurora-context.review.json', 'aurora-live.review.json']) {
    const raw = await readFile(join(coreRoot, 'samples', name), 'utf8')
    const parsed = JSON.parse(raw)
    assert.equal(typeof parsed.summary, 'string')
    assert.ok(Array.isArray(parsed.blocking))
    assert.ok(Array.isArray(parsed.suggestions))
    assert.ok(Array.isArray(parsed.risks))
    assert.ok(Array.isArray(parsed.action_items))
  }
})
