import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadRepoContext } from '../dist/context.js'

test('loadRepoContext includes file tree and README excerpt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'art-context-'))
  try {
    await writeFile(join(dir, 'README.md'), 'hello project readme', 'utf8')
    await mkdir(join(dir, 'src'))
    await writeFile(join(dir, 'src', 'index.js'), 'console.log(1)', 'utf8')
    await writeFile(join(dir, 'package.json'), '{"name":"demo"}', 'utf8')

    const context = await loadRepoContext({ root: dir, maxChars: 4000 })
    assert.match(context, /# Repository Context/)
    assert.match(context, /README\.md/)
    assert.match(context, /hello project readme/)
    assert.match(context, /package\.json/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('loadRepoContext truncates when maxChars is small', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'art-context-'))
  try {
    await writeFile(join(dir, 'README.md'), 'a'.repeat(2000), 'utf8')
    const context = await loadRepoContext({ root: dir, maxChars: 200 })
    assert.ok(context.length <= 300)
    assert.match(context, /truncated/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('loadRepoContext rejects missing roots instead of silently returning empty context', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'art-context-'))
  try {
    await assert.rejects(
      loadRepoContext({ root: join(dir, 'missing') }),
      /does not exist/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
