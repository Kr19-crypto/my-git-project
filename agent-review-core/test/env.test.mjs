import test from 'node:test'
import assert from 'node:assert/strict'
import { applyDotEnv } from '../dist/env.js'

test('applyDotEnv parses simple .env content', () => {
  delete process.env.TEST_ART_KEY
  applyDotEnv('TEST_ART_KEY=hello\n')
  assert.equal(process.env.TEST_ART_KEY, 'hello')
  delete process.env.TEST_ART_KEY
})

test('applyDotEnv does not override existing env values', () => {
  process.env.TEST_ART_KEY = 'existing'
  applyDotEnv('TEST_ART_KEY=new-value\n')
  assert.equal(process.env.TEST_ART_KEY, 'existing')
  delete process.env.TEST_ART_KEY
})

test('applyDotEnv ignores comments and blanks', () => {
  process.env.TEST_ART_EMPTY = 'x'
  applyDotEnv('# comment\n\nTEST_ART_EMPTY=y\n')
  assert.equal(process.env.TEST_ART_EMPTY, 'x')
  delete process.env.TEST_ART_EMPTY
})
