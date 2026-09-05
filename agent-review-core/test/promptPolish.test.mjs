import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPromptPolishUserMessage,
  polishPrompt,
  PROMPT_POLISH_SYSTEM_PROMPT,
} from '../dist/promptPolish.js'

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

test('buildPromptPolishUserMessage keeps original text and optional context', () => {
  const message = buildPromptPolishUserMessage({
    text: '帮我写一个脚本',
    instruction: '面向 PowerShell，明确验收标准',
    context: '运行环境 Windows 11',
  })
  assert.match(message, /帮我写一个脚本/)
  assert.match(message, /面向 PowerShell/)
  assert.match(message, /运行环境 Windows 11/)
  assert.match(message, /反馈与改进后的提示词/)
})

test('polishPrompt calls LLM and returns polished text', async () => {
  let called = false
  const restore = withFetch(async (url, init) => {
    called = true
    assert.match(String(url), /chat\/completions$/)
    const body = JSON.parse(String(init.body))
    assert.equal(body.messages[0].content, PROMPT_POLISH_SYSTEM_PROMPT)
    assert.match(body.messages[1].content, /帮我写一个脚本/)
    return jsonResponse(200, {
      choices: [
        {
          message: {
            content: JSON.stringify({
              feedback: {
                summary: '原提示词目标不清，缺少验收标准。',
                blocking: ['没有明确运行环境', '没有定义成功标准'],
                suggestions: ['补充可验证的测试命令'],
                risks: ['可能在错误 shell 中执行'],
                action_items: ['补充环境与验收步骤'],
              },
              text: '改进后的提示词',
            }),
          },
        },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
    })
  })
  process.env.LLM_MAX_RETRIES = '0'
  try {
    const result = await polishPrompt({
      text: '帮我写一个脚本',
      apiKey: 'test-key',
      baseUrl: 'https://example.com/v1',
      model: 'test-model',
    })
    assert.equal(called, true)
    assert.equal(result.text, '改进后的提示词')
    assert.equal(result.originalText, '帮我写一个脚本')
    assert.equal(result.feedback.summary, '原提示词目标不清，缺少验收标准。')
    assert.deepEqual(result.feedback.blocking, [
      '没有明确运行环境',
      '没有定义成功标准',
    ])
    assert.ok(result.feedback.action_items.length > 0)
    assert.equal(result.model, 'test-model')
    assert.equal(result.usage.totalTokens, 28)
  } finally {
    delete process.env.LLM_MAX_RETRIES
    restore()
  }
})

test('polishPrompt falls back to plain text when LLM does not return JSON', async () => {
  const restore = withFetch(async () =>
    jsonResponse(200, {
      choices: [{ message: { content: '只是一段改进提示词' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
  )
  process.env.LLM_MAX_RETRIES = '0'
  try {
    const result = await polishPrompt({
      text: '写一个脚本',
      apiKey: 'test-key',
      baseUrl: 'https://example.com/v1',
      model: 'test-model',
    })
    assert.equal(result.text, '只是一段改进提示词')
    assert.deepEqual(result.feedback.blocking, [])
  } finally {
    delete process.env.LLM_MAX_RETRIES
    restore()
  }
})


test('polishPrompt rejects empty text', async () => {
  await assert.rejects(
    polishPrompt({
      text: '   ',
      apiKey: 'test-key',
      baseUrl: 'https://example.com/v1',
      model: 'test-model',
    }),
    /non-empty prompt text/,
  )
})
