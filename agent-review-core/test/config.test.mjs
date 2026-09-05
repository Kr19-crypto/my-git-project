import test from 'node:test'
import assert from 'node:assert/strict'
import { applyRoleModelRouting } from '../dist/config.js'

test('applyRoleModelRouting applies core/aux model envs by tier', () => {
  const roles = [
    { id: 'architect', model: 'default', tier: 'core' },
    { id: 'tester', model: 'default', tier: 'aux' },
    { id: 'unknown', model: 'default' },
  ]

  process.env.LLM_CORE_MODEL = 'core-model'
  process.env.LLM_AUX_MODEL = 'aux-model'

  const routed = applyRoleModelRouting(roles)
  assert.equal(routed[0].model, 'core-model')
  assert.equal(routed[1].model, 'aux-model')
  assert.equal(routed[2].model, 'default')

  delete process.env.LLM_CORE_MODEL
  delete process.env.LLM_AUX_MODEL
})

test('applyRoleModelRouting per-role env has highest priority', () => {
  const roles = [{ id: 'architect', model: 'default', tier: 'core' }]
  process.env.LLM_CORE_MODEL = 'core-model'
  process.env.LLM_ROLE_ARCHITECT_MODEL = 'architect-model'

  const routed = applyRoleModelRouting(roles)
  assert.equal(routed[0].model, 'architect-model')

  delete process.env.LLM_CORE_MODEL
  delete process.env.LLM_ROLE_ARCHITECT_MODEL
})

test('applyRoleModelRouting maps per-role base URL provider override', () => {
  const roles = [{ id: 'architect', model: 'deepseek-chat', tier: 'core' }]
  process.env.LLM_ROLE_ARCHITECT_BASE_URL = 'https://openrouter.ai/api/v1'

  const routed = applyRoleModelRouting(roles)
  assert.equal(routed[0].model, 'deepseek-chat')
  assert.equal(routed[0].baseUrl, 'https://openrouter.ai/api/v1')

  delete process.env.LLM_ROLE_ARCHITECT_BASE_URL
})
