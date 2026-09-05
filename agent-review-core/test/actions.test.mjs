import test from 'node:test'
import assert from 'node:assert/strict'
import { buildActionPrompt } from '../dist/actions.js'

test('buildActionPrompt includes action items', () => {
  const result = {
    summary: 'summary',
    blocking: ['blocking A'],
    suggestions: [],
    risks: [],
    action_items: ['fix A', 'add tests'],
    transcript: [],
    truncated: false,
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  }

  const prompt = buildActionPrompt(result)
  assert.match(prompt, /fix A/)
  assert.match(prompt, /add tests/)
  assert.match(prompt, /下一步开发指令/)
})

test('buildActionPrompt optionally includes blocking and summary', () => {
  const result = {
    summary: 'summary text',
    blocking: ['blocking A'],
    suggestions: [],
    risks: [],
    action_items: ['fix A'],
    transcript: [],
    truncated: false,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  }

  const prompt = buildActionPrompt(result, {
    includeBlocking: true,
    includeSummary: true,
  })
  assert.match(prompt, /summary text/)
  assert.match(prompt, /blocking A/)
})
