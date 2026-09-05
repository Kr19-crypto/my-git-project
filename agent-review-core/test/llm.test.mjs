import test from 'node:test'
import assert from 'node:assert/strict'
import { callLlm } from '../dist/llm.js'

const baseOptions = {
  apiKey: 'test-key',
  baseUrl: 'https://example.com/v1',
  model: 'test-model',
  systemPrompt: 'system',
  userPrompt: 'user',
  maxOutputTokens: 10,
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function withFetch(fetchImpl) {
  const original = globalThis.fetch
  globalThis.fetch = fetchImpl
  return () => {
    globalThis.fetch = original
  }
}

test('callLlm rejects when apiKey is missing', async () => {
  await assert.rejects(
    callLlm({ ...baseOptions, apiKey: '' }),
    /Missing LLM_API_KEY/,
  )
})

test('callLlm parses a successful response', async () => {
  const restore = withFetch(async (_url, _init) =>
    jsonResponse(200, {
      choices: [{ message: { content: '  hello review  ' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
  )
  try {
    const result = await callLlm(baseOptions)
    assert.equal(result.text, 'hello review')
    assert.equal(result.usage.totalTokens, 15)
  } finally {
    restore()
  }
})

test('callLlm retries transient 5xx responses and succeeds on the next attempt', async () => {
  let calls = 0
  const restore = withFetch(async (_url, _init) => {
    calls += 1
    if (calls === 1) return jsonResponse(500, { error: 'boom' })
    return jsonResponse(200, {
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })
  })
  process.env.LLM_MAX_RETRIES = '2'
  try {
    const result = await callLlm(baseOptions)
    assert.equal(result.text, 'ok')
    assert.equal(calls, 2)
  } finally {
    delete process.env.LLM_MAX_RETRIES
    restore()
  }
})

test('callLlm does not retry non-transient 4xx errors', async () => {
  let calls = 0
  const restore = withFetch(async (_url, _init) => {
    calls += 1
    return jsonResponse(400, { error: 'bad request' })
  })
  try {
    await assert.rejects(callLlm(baseOptions), /LLM API error 400/)
    assert.equal(calls, 1)
  } finally {
    restore()
  }
})

test('callLlm turns fetch abort into a timeout error', async () => {
  const restore = withFetch(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
      }),
  )
  process.env.LLM_TIMEOUT_MS = '50'
  process.env.LLM_MAX_RETRIES = '0'
  try {
    await assert.rejects(callLlm(baseOptions), /timeout/)
  } finally {
    delete process.env.LLM_TIMEOUT_MS
    delete process.env.LLM_MAX_RETRIES
    restore()
  }
})
