import test from 'node:test'
import assert from 'node:assert/strict'
import { runRoundtable } from '../dist/roundtable.js'

const role = {
  id: 'maintainer',
  name: '维护者',
  description: 'final reviewer',
  systemPrompt: 'You are the maintainer.',
  model: 'test-model',
  maxOutputTokens: 200,
  tier: 'core',
}

const request = {
  source: 'test.diff',
  diff: '+ line one\n+ line two\n',
}

test('runRoundtable mock mode returns a structured review', async () => {
  const result = await runRoundtable(
    request,
    { roles: [role], rounds: 1, budgetLimitTokens: 10000, summaryReserveTokens: 1000, mock: true },
    { apiKey: '', baseUrl: 'https://example.com/v1' },
  )
  assert.match(result.summary, /mock/i)
  assert.ok(Array.isArray(result.blocking))
  assert.ok(Array.isArray(result.action_items))
  assert.equal(result.transcript.length, 1)
})

test('runRoundtable continues when an individual LLM role call fails', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: 'boom' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  process.env.LLM_MAX_RETRIES = '0'
  try {
    const result = await runRoundtable(
      request,
      { roles: [role], rounds: 1, budgetLimitTokens: 10000, summaryReserveTokens: 1000, mock: false },
      { apiKey: 'test-key', baseUrl: 'https://example.com/v1' },
    )
    assert.equal(result.transcript.length, 1)
    assert.match(result.transcript[0].content, /\[error\]/)
  } finally {
    delete process.env.LLM_MAX_RETRIES
    globalThis.fetch = originalFetch
  }
})

test('runRoundtable honors beforeSpeech abort control', async () => {
  const result = await runRoundtable(
    request,
    { roles: [role], rounds: 1, budgetLimitTokens: 10000, summaryReserveTokens: 1000, mock: true },
    {
      apiKey: '',
      baseUrl: 'https://example.com/v1',
      beforeSpeech: async () => 'abort',
    },
  )
  assert.equal(result.transcript.length, 0)
  assert.equal(result.truncated, true)
})
