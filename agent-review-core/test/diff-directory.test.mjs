import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadDiff } from '../dist/diff.js'

test('directory mode includes code files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'art-dir-'))
  try {
    await mkdir(join(dir, 'src'))
    await writeFile(join(dir, 'src', 'main.py'), 'print("hello")\n', 'utf8')
    const request = await loadDiff({ directory: dir })
    assert.match(request.diff, /main\.py/)
    assert.match(request.diff, /print\("hello"\)/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('directory mode throws clear error when no reviewable files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'art-empty-'))
  try {
    await assert.rejects(
      loadDiff({ directory: dir }),
      /Diff is empty/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
