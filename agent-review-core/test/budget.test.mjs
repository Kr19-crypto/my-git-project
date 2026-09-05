import test from 'node:test'
import assert from 'node:assert/strict'
import { roughTokens, estimateCost } from '../dist/budget.js'

test('roughTokens returns positive estimate for text', () => {
  assert.equal(roughTokens(''), 0)
  assert.ok(roughTokens('hello world') > 0)
  assert.ok(roughTokens('中文测试文本') > 0)
})

test('estimateCost charges each role per round', () => {
  const roles = [
    {
      id: 'architect',
      name: '架构师',
      description: 'arch',
      systemPrompt: 'system prompt',
      model: 'deepseek-chat',
      maxOutputTokens: 100,
      weight: 1,
    },
    {
      id: 'tester',
      name: '测试',
      description: 'test',
      systemPrompt: 'system prompt 2',
      model: 'deepseek-chat',
      maxOutputTokens: 100,
      weight: 1,
    },
  ]
  const estimate = estimateCost(
    { diff: 'diff text' },
    roles,
    2,
  )
  assert.equal(estimate.roles.length, 2)
  assert.ok(estimate.estimatedTotalTokens > 0)
})
