import test from 'node:test'
import assert from 'node:assert/strict'
import { renderMarkdownReview } from '../dist/report.js'

test('renderMarkdownReview includes all review sections', () => {
  const result = {
    source: 'sample.diff',
    summary: 'summary text',
    blocking: ['block A'],
    suggestions: ['suggest B'],
    risks: ['risk C'],
    action_items: ['action D'],
    transcript: [
      {
        roleId: 'architect',
        roleName: '架构师',
        round: 1,
        content: 'architect says',
      },
    ],
    truncated: false,
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
  }

  const markdown = renderMarkdownReview(result)
  assert.match(markdown, /# Review Report/)
  assert.match(markdown, /summary text/)
  assert.match(markdown, /block A/)
  assert.match(markdown, /suggest B/)
  assert.match(markdown, /risk C/)
  assert.match(markdown, /action D/)
  assert.match(markdown, /architect says/)
})
