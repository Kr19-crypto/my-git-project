import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  isPathInside,
  assertPathInside,
  assertReadableDirectory,
  assertSafeOutputPath,
} from '../dist/paths.js'

test('isPathInside accepts children and rejects parent escapes', async () => {
  const base = await mkdtemp(join(tmpdir(), 'art-paths-'))
  try {
    assert.equal(isPathInside(base, join(base, 'report.md')), true)
    assert.equal(isPathInside(base, join(base, 'sub', 'report.md')), true)
    assert.equal(isPathInside(base, join(base, '..', 'outside.md')), false)
    assert.equal(isPathInside(base, join(base, '..', 'other', 'x.txt')), false)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('assertPathInside throws when a lexical path escapes the base', async () => {
  const base = await mkdtemp(join(tmpdir(), 'art-paths-'))
  try {
    assert.throws(() => assertPathInside(base, join(base, '..', 'escape.md'), 'output'), /escapes/)
    const ok = assertPathInside(base, join(base, 'ok.md'), 'output')
    assert.equal(ok, join(base, 'ok.md'))
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('assertReadableDirectory resolves a real directory and rejects files/missing paths', async () => {
  const base = await mkdtemp(join(tmpdir(), 'art-paths-'))
  try {
    const file = join(base, 'a.txt')
    await writeFile(file, 'x', 'utf8')
    const resolvedDir = await assertReadableDirectory(base, 'context')
    assert.equal(resolvedDir, base)
    await assert.rejects(assertReadableDirectory(file, 'context'), /must be a directory/)
    await assert.rejects(assertReadableDirectory(join(base, 'missing'), 'context'), /does not exist/)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('assertSafeOutputPath allows writes under base and rejects outside paths', async () => {
  const base = await mkdtemp(join(tmpdir(), 'art-paths-'))
  try {
    await mkdir(join(base, 'out'))
    const inside = await assertSafeOutputPath(join(base, 'out', 'review.md'), base, '--output')
    assert.equal(inside, join(base, 'out', 'review.md'))
    await assert.rejects(
      assertSafeOutputPath(join(base, '..', 'evil.md'), base, '--output'),
      /escapes/,
    )
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
