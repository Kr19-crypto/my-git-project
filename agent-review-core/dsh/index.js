/**
 * DSH plugin adapter for Agent Review Roundtable.
 *
 * Registers an agent-callable tool `agent_review_roundtable` inside DeepSeek
 * Harness. The tool reuses the compiled core modules from `dist/`, so it does
 * not spawn the CLI as a subprocess.
 *
 * Install (from this repo):
 *   dsh plugin --profile web add D:\WORK AREA\HACK-Blue-Fat-Fish\agent-review-core
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { readFile, writeFile } from 'node:fs/promises'
import { loadProjectEnv } from '../dist/env.js'
import { loadDiff } from '../dist/diff.js'
import { loadRepoContext } from '../dist/context.js'
import { getDefaultRoles } from '../dist/defaultRoles.js'
import { applyRoleModelRouting, createConfig } from '../dist/config.js'
import { runRoundtable } from '../dist/roundtable.js'
import { buildActionPrompt } from '../dist/actions.js'
import { polishPrompt } from '../dist/promptPolish.js'

export const name = 'agent-review-roundtable'
export const inject = ['tools', 'credentials', 'sessions']

const ROLE_PAUSE_MS = 3000

/**
 * Merge key=value updates into an existing .env file body.
 *
 * - Existing keys are updated in place (order preserved).
 * - New keys are appended at the end.
 * - Comments/blank lines and unrelated variables (e.g. LLM_TIMEOUT_MS,
 *   manually set LLM_ROLE_* lines) are preserved.
 * - Missing/unreadable files start from an empty body.
 */
async function mergeDotEnv(url, updates) {
  let lines = []
  try {
    const text = await readFile(url, 'utf8')
    lines = text.split('\n')
  } catch (error) {
    lines = []
  }
  const indexByKey = new Map()
  const keyOf = (line) => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line)
    return match ? match[1] : null
  }
  lines.forEach((line, i) => {
    const key = keyOf(line)
    if (key && !indexByKey.has(key)) indexByKey.set(key, i)
  })
  Object.entries(updates).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    const line = `${key}=${value}`
    if (indexByKey.has(key)) {
      lines[indexByKey.get(key)] = line
    } else {
      indexByKey.set(key, lines.length)
      lines.push(line)
    }
  })
  // Drop trailing blank entries from split() so saves don't accumulate blanks.
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines.join('\n') + '\n'
}

export function apply(ctx) {
  const credentials = ctx.credentials
  const progressListeners = new Set()
  const progressEvents = []
  let lastResult = null
  const reviewHistory = []
  const channelMessages = new Map()
  let setupConfigured = Boolean(process.env.LLM_API_KEY) || process.env.ART_CONFIGURED === '1'
  void loadProjectEnv().then(() => { if (process.env.LLM_API_KEY) setupConfigured = true })
  const roleOverrides = new Map()
  const pausedChannels = new Set()
  const resolveApiKey = async () => {
    if (process.env.LLM_API_KEY) return process.env.LLM_API_KEY
    if (credentials && typeof credentials.resolve === 'function') {
      try {
        const cred = await credentials.resolve('DEEPSEEK_API_KEY')
        if (cred && cred.value) return String(cred.value)
      } catch (error) {
        // Optional; fall back to empty key so callLlm can report cleanly.
      }
    }
    return ''
  }
  // Per-channel pause waiters. Pausing/resuming one channel must never wake
  // waiters of another channel (previously one global set was woken by any
  // pause or resume, so concurrent channels could resume each other).
  const pauseWaitersByChannel = new Map()

  const messagesOf = (channel) => {
    if (!channelMessages.has(channel)) channelMessages.set(channel, [])
    return channelMessages.get(channel)
  }
  const isChannelPaused = (channel) => pausedChannels.has(channel)
  const waitersOf = (channel) => {
    if (!pauseWaitersByChannel.has(channel)) {
      pauseWaitersByChannel.set(channel, new Set())
    }
    return pauseWaitersByChannel.get(channel)
  }
  const setChannelPaused = (channel, paused) => {
    if (paused) {
      pausedChannels.add(channel)
    } else {
      pausedChannels.delete(channel)
      // Only a resume may wake waiters — and only waiters of this channel.
      const waiters = pauseWaitersByChannel.get(channel)
      if (waiters) {
        for (const waiter of [...waiters]) {
          try { waiter() } catch (e) { waiters.delete(waiter) }
        }
        waiters.clear()
      }
    }
  }
  const waitWhilePaused = (channel, timeoutMs) => {
    if (!isChannelPaused(channel)) return Promise.resolve(false)
    return new Promise((resolve) => {
      let done = false
      const finish = (timedOut) => {
        if (done) return
        done = true
        clearTimeout(timer)
        waitersOf(channel).delete(waiter)
        resolve(timedOut)
      }
      const timer = setTimeout(() => finish(true), timeoutMs)
      const waiter = () => finish(false)
      waitersOf(channel).add(waiter)
    })
  }

  const emitProgress = (event) => {
    const ev = { ...event, time: Date.now() }
    progressEvents.push(ev)
    if (progressEvents.length > 100) progressEvents.shift()
    for (const send of progressListeners) {
      try { send(ev) } catch (err) { progressListeners.delete(send) }
    }
  }

    const addHistoryEntry = (result) => {
      const entry = {
        id: 'rev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
        time: Date.now(),
        source: result.source || undefined,
        summary: result.summary || '',
        blocking: Array.isArray(result.blocking) ? result.blocking : [],
        action_items: Array.isArray(result.action_items) ? result.action_items : [],
        action_prompt: result.action_prompt || undefined,
      }
      reviewHistory.unshift(entry)
      if (reviewHistory.length > 50) reviewHistory.pop()
      if (process.env.ART_HISTORY_FILE) {
        writeFile(process.env.ART_HISTORY_FILE, JSON.stringify(reviewHistory, null, 2), 'utf8').catch(() => {})
      }
      return entry
    }


  ctx.tools.register(defineTool({
    name: 'agent_review_roundtable',
    description:
      'Run a multi-agent roundtable code review on a git repo diff, diff file, or non-git directory. ' +
      'Reads repository context when available and returns structured blocking issues, ' +
      'suggestions, risks, and action items. Use when the user wants code/PR review, ' +
      'multi-role review, or to prepare next-step fixes from a code change.',
    parameters: {
      repo: {
        type: 'string',
        description: 'Local git repository path; uses the current working-tree diff by default.',
      },
        directory: {
          type: 'string',
          description: 'Review a non-git directory (creates a snapshot pseudo-diff).',
        },
      diffFile: {
        type: 'string',
        description: 'Path to a diff/patch file instead of a git repo.',
      },
      path: {
        type: 'string',
        description: 'Optional file path to limit the git diff to one file.',
      },
      task: {
        type: 'string',
        description: 'Optional task/feature description to guide reviewers.',
      },
      rounds: {
        type: 'number',
        description: 'Number of discussion rounds (default 1, max 3).',
      },
      budget: {
        type: 'number',
        description: 'Hard token budget for the whole review (default 120000).',
      },
      contextDir: {
        type: 'string',
        description: 'Optional directory to load repository context from. Defaults to repo when repo is set.',
      },
      noContext: {
        type: 'boolean',
        description: 'Disable automatic repository context loading.',
      },
      mock: {
        type: 'boolean',
        description: 'Run offline with canned speeches (for testing).',
      },
      channel: {
        type: 'string',
        description: 'Optional collaboration channel id shared with another session (e.g. "task-1").',
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => {
        const result = value ?? {}
        const lines = []
        lines.push(`## Review Summary`)
        lines.push(result.summary || '（未生成总结）')
        lines.push('')
        if (Array.isArray(result.blocking) && result.blocking.length) {
          lines.push('### Blocking')
          result.blocking.forEach((item) => lines.push(`- ${item}`))
          lines.push('')
        }
        if (Array.isArray(result.action_items) && result.action_items.length) {
          lines.push('### Action Items')
          result.action_items.forEach((item, index) => lines.push(`${index + 1}. ${item}`))
          lines.push('')
        }
        if (result.usage) {
          lines.push(`Usage: ${result.usage.totalTokens?.toLocaleString?.() ?? result.usage.totalTokens} tokens`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    execute: async (args) => {
      await loadProjectEnv()

      const repo = typeof args.repo === 'string' ? args.repo : undefined
      const diffFile = typeof args.diffFile === 'string' ? args.diffFile : undefined
      const directory = typeof args.directory === 'string' ? args.directory : undefined
      const path = typeof args.path === 'string' ? args.path : undefined
      const task = typeof args.task === 'string' ? args.task : undefined
      const rounds = clampInt(args.rounds, 1, 1, 3)
      const budget = clampInt(args.budget, 120000, 1000, 2000000)
      const contextDir = typeof args.contextDir === 'string' ? args.contextDir : undefined
      const noContext = args.noContext === true
      const mock = args.mock === true
        const channel = typeof args.channel === 'string' ? args.channel : undefined

      if (!repo && !directory && !diffFile) {
        throw new Error('agent_review_roundtable requires one of "repo", "directory", or "diffFile".')
      }

      const request = await loadDiff({ repo, directory, diffFile, path, task })
      if (!noContext) {
        const root = contextDir ?? (repo ? repo : directory ? directory : undefined)
        if (root) {
          request.repoContext = await loadRepoContext({ root })
        }
      }

      const roles = applyRoleModelRouting(getDefaultRoles()).map((role) => {
        const override = roleOverrides.get(role.id)
        if (!override) return role
        return { ...role, model: override.model, baseUrl: override.baseUrl }
      })
      const config = createConfig(
        {
          repo,
          diffFile,
          path,
          task,
          rounds,
          budgetLimitTokens: budget,
          mock,
          yes: true,
        },
        roles,
      )

      let apiKey = process.env.LLM_API_KEY ?? ''
      if (!apiKey && credentials && typeof credentials.resolve === 'function') {
        try {
          const cred = await credentials.resolve('DEEPSEEK_API_KEY')
          if (cred && cred.value) apiKey = String(cred.value)
        } catch (error) {
          // Credential resolution is optional; fall back to env / .env.
        }
      }
      const baseUrl = process.env.LLM_BASE_URL ?? 'https://api.deepseek.com/v1'

      // Run-scoped emitter: every event emitted by this run carries the run's
      // channel, so multi-session UIs can ignore events from other channels.
      const emit = (event) => emitProgress({ ...event, channel: channel || null })

      // Clear stale state from previous runs: a finished/aborted review must
      // not leave this channel paused (stalling the next run) nor keep a stale
      // last-result visible to the peer session while a new review is running.
      if (channel) setChannelPaused(channel, false)
      lastResult = null

      emit({ type: 'start', text: '评审开始' })
      let result
      try {
        result = await runRoundtable(request, config, {
          apiKey,
          baseUrl,
            beforeSpeech: async (info) => {
              const hadPause = channel ? isChannelPaused(channel) : false
              if (channel && isChannelPaused(channel)) {
                emit({
                  type: 'paused',
                  text: `评审已暂停，等待会话 B 恢复…`,
                })
                const timedOut = await waitWhilePaused(channel, 120000)
                emit({
                  type: timedOut ? 'paused_timeout' : 'resumed',
                  text: timedOut ? '等待超时，继续评审' : '已恢复评审',
                })
              }
              if (!hadPause && info.currentIndex > 1) {
                const seconds = Math.round(ROLE_PAUSE_MS / 1000)
                emit({ type: 'between_roles', text: `${seconds}s 后开始下一位角色…` })
                await new Promise((resolve) => setTimeout(resolve, ROLE_PAUSE_MS))
              }
              emit({
                type: 'role_start',
                role: info.roleName,
                round: info.round,
                text: `${info.roleName} 开始发言`,
              })
              return 'continue'
            },
          onSpeech: (speech) => {
            const content = (speech.content || '').trim()
            emit({
              type: 'role_speech',
              role: speech.roleName,
              round: speech.round,
              text: `${speech.roleName}：${content || '（无文本）'}`,
            })
          },
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        emit({ type: 'error', text: `评审失败：${message}` })
        throw error
      }
      emit({ type: 'done', text: '评审完成' })
      const finalResult = {
        ...result,
        action_prompt: buildActionPrompt(result, { includeBlocking: true, includeSummary: true }),
      }
      lastResult = finalResult
      addHistoryEntry(finalResult)
      return finalResult
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_review_polish_prompt',
    description:
      'Improve/polish a draft prompt (辅助提示词改进) before sending it to a coding agent or review session. ' +
      'Rewrites raw text into a clearer, more actionable prompt using the configured LLM.',
    parameters: {
      text: { type: 'string', required: true, description: 'Raw prompt/draft text to improve.' },
      instruction: {
        type: 'string',
        description: 'Optional extra instruction, e.g. "更结构化，面向 PowerShell 开发任务".',
      },
      context: {
        type: 'string',
        description: 'Optional context/constraints that should be considered.',
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => {
        const v = value ?? {}
        if (v.ok !== true) {
          return [{ type: 'text', text: v.error || 'polish failed' }]
        }
        const lines = []
        const feedback = v.feedback || {}
        if (feedback.summary || feedback.blocking?.length || feedback.suggestions?.length) {
          lines.push('## 提示词反馈')
          if (feedback.summary) lines.push(feedback.summary)
          if (Array.isArray(feedback.blocking) && feedback.blocking.length) {
            lines.push('')
            lines.push('### Blocking')
            feedback.blocking.forEach((item) => lines.push(`- ${item}`))
          }
          if (Array.isArray(feedback.suggestions) && feedback.suggestions.length) {
            lines.push('')
            lines.push('### Suggestions')
            feedback.suggestions.forEach((item) => lines.push(`- ${item}`))
          }
          if (Array.isArray(feedback.risks) && feedback.risks.length) {
            lines.push('')
            lines.push('### Risks')
            feedback.risks.forEach((item) => lines.push(`- ${item}`))
          }
          if (Array.isArray(feedback.action_items) && feedback.action_items.length) {
            lines.push('')
            lines.push('### Action Items')
            feedback.action_items.forEach((item, i) => lines.push(`${i + 1}. ${item}`))
          }
          lines.push('')
        }
        lines.push('## Polished Prompt')
        lines.push('')
        lines.push(v.text || '')
        if (v.usage) {
          lines.push('')
          lines.push(`Usage: ${v.usage.totalTokens} tokens`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    execute: async (args) => {
      await loadProjectEnv()
      const text = String(args.text || '').trim()
      if (!text) return { ok: false, error: 'text is required' }
      const apiKey = await resolveApiKey()
      if (!apiKey) {
        return { ok: false, error: 'Missing LLM_API_KEY. Set LLM_API_KEY or DEEPSEEK_API_KEY credential.' }
      }
      const instruction =
        typeof args.instruction === 'string' && args.instruction.trim()
          ? args.instruction.trim()
          : undefined
      const context =
        typeof args.context === 'string' && args.context.trim()
          ? args.context.trim()
          : undefined
      const result = await polishPrompt({
        text,
        instruction,
        context,
        apiKey,
        baseUrl: process.env.LLM_BASE_URL ?? 'https://api.deepseek.com/v1',
        model:
          process.env.LLM_PROMPT_MODEL ??
          process.env.LLM_CORE_MODEL ??
          'deepseek-chat',
      })
      return { ok: true, text: result.text, feedback: result.feedback, model: result.model, usage: result.usage }
    },
  }))


  ctx.tools.register(defineTool({
    name: 'agent_review_last_result',
    description:
      'Fetch the most recent Agent Review Roundtable result from this DSH host. ' +
      'Use this from a second session/window to review what another session produced.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => {
        const v = value ?? {}
        if (v.ok !== true || !v.result) {
          return [{ type: 'text', text: v.error || 'No review result yet.' }]
        }
        const r = v.result
        const lines = []
        lines.push(`## Review Summary`)
        lines.push(r.summary || '')
        lines.push('')
        if (Array.isArray(r.blocking) && r.blocking.length) {
          lines.push('### Blocking')
          r.blocking.forEach((item) => lines.push(`- ${item}`))
        }
        lines.push('')
        lines.push(`Action prompt ready: ${r.action_prompt ? 'yes' : 'no'}`)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    execute: async () => {
      if (!lastResult) {
        return { ok: false, error: 'No Agent Review Roundtable result yet in this DSH host.' }
      }
      return { ok: true, result: lastResult }
    },
  }))

  ctx.tools.register(defineTool({

    name: 'agent_review_history',
    description: 'List recent Agent Review Roundtable history entries.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => {
        const v = value ?? {}
        if (v.ok !== true) return [{ type: 'text', text: v.error || 'no history' }]
        const lines = [`history: ${v.entries.length}`]
        v.entries.forEach((entry) => {
          lines.push(`- ${entry.id} ${new Date(entry.time).toLocaleString()} ${entry.source || ''} :: ${entry.summary || ''}`)
        })
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    execute: async () => {
      return { ok: true, entries: reviewHistory.map((entry) => ({
        id: entry.id,
        time: entry.time,
        source: entry.source,
        summary: entry.summary,
        blocking: entry.blocking,
        action_items: entry.action_items,
      })) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_review_show',
    description: 'Show one saved review by history id.',
    parameters: {
      id: { type: 'string', required: true, description: 'History entry id from agent_review_history.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => {
        const v = value ?? {}
        if (v.ok !== true) return [{ type: 'text', text: v.error || 'not found' }]
        const r = v.entry
        const lines = [`# ${r.summary || ''}`]
        if (Array.isArray(r.blocking) && r.blocking.length) {
          lines.push('## Blocking')
          r.blocking.forEach((item) => lines.push(`- ${item}`))
        }
        if (Array.isArray(r.action_items) && r.action_items.length) {
          lines.push('## Action Items')
          r.action_items.forEach((item, i) => lines.push(`${i + 1}. ${item}`))
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    execute: async (args) => {
      const entry = reviewHistory.find((item) => item.id === String(args.id || ''))
      if (!entry) return { ok: false, error: 'review not found' }
      return { ok: true, entry }
    },
  }))

    ctx.tools.register(defineTool({
    name: 'agent_review_send_comment',
    description: 'Send a comment/review note to a collaboration channel. Another session can read it via agent_review_inbox.',
    parameters: {
      channel: { type: 'string', required: true, description: 'Shared collaboration channel id.' },
      text: { type: 'string', required: true, description: 'Comment text.' },
    },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => {
          const v = value ?? {}
          const lines = []
          lines.push(`ok: ${v.ok === true ? 'true' : 'false'}`)
          if (v.channel) lines.push(`channel: ${v.channel}`)
          if (v.paused !== undefined) lines.push(`paused: ${v.paused ? 'true' : 'false'}`)
          if (v.message && v.message.text) lines.push(`comment: ${v.message.text}`)
          if (Array.isArray(v.messages)) {
            lines.push(`messages: ${v.messages.length}`)
            v.messages.forEach((m, i) => lines.push(`${i + 1}. ${m.text || JSON.stringify(m)}`))
          }
          if (v.error) lines.push(`error: ${v.error}`)
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
    execute: async (args) => {
      const channel = String(args.channel || '').trim()
      const text = String(args.text || '').trim()
      if (!channel || !text) return { ok: false, error: 'channel and text are required' }
      const msg = { channel, text, from: 'B', time: Date.now() }
      messagesOf(channel).push(msg)
      emitProgress({ type: 'comment', channel, text: `[B] ${text}` })
      return { ok: true, message: msg }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_review_pause_channel',
    description: 'Pause a running review on a collaboration channel. The review will wait at the next role boundary.',
    parameters: {
      channel: { type: 'string', required: true, description: 'Shared collaboration channel id.' },
    },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => {
          const v = value ?? {}
          const lines = []
          lines.push(`ok: ${v.ok === true ? 'true' : 'false'}`)
          if (v.channel) lines.push(`channel: ${v.channel}`)
          if (v.paused !== undefined) lines.push(`paused: ${v.paused ? 'true' : 'false'}`)
          if (v.message && v.message.text) lines.push(`comment: ${v.message.text}`)
          if (Array.isArray(v.messages)) {
            lines.push(`messages: ${v.messages.length}`)
            v.messages.forEach((m, i) => lines.push(`${i + 1}. ${m.text || JSON.stringify(m)}`))
          }
          if (v.error) lines.push(`error: ${v.error}`)
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
    execute: async (args) => {
      const channel = String(args.channel || '').trim()
      if (!channel) return { ok: false, error: 'channel is required' }
      setChannelPaused(channel, true)
      emitProgress({ type: 'pause_requested', channel, text: `B 请求暂停 channel ${channel}` })
      return { ok: true, paused: true, channel }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_review_resume_channel',
    description: 'Resume a paused review on a collaboration channel.',
    parameters: {
      channel: { type: 'string', required: true, description: 'Shared collaboration channel id.' },
    },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => {
          const v = value ?? {}
          const lines = []
          lines.push(`ok: ${v.ok === true ? 'true' : 'false'}`)
          if (v.channel) lines.push(`channel: ${v.channel}`)
          if (v.paused !== undefined) lines.push(`paused: ${v.paused ? 'true' : 'false'}`)
          if (v.message && v.message.text) lines.push(`comment: ${v.message.text}`)
          if (Array.isArray(v.messages)) {
            lines.push(`messages: ${v.messages.length}`)
            v.messages.forEach((m, i) => lines.push(`${i + 1}. ${m.text || JSON.stringify(m)}`))
          }
          if (v.error) lines.push(`error: ${v.error}`)
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
    execute: async (args) => {
      const channel = String(args.channel || '').trim()
      if (!channel) return { ok: false, error: 'channel is required' }
      setChannelPaused(channel, false)
      emitProgress({ type: 'resume_requested', channel, text: `B 已恢复 channel ${channel}` })
      return { ok: true, paused: false, channel }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_review_inbox',
    description: 'Read pending comments and pause state for a collaboration channel. Use in session A to receive instructions from session B.',
    parameters: {
      channel: { type: 'string', required: true, description: 'Shared collaboration channel id.' },
      clear: { type: 'boolean', description: 'Clear messages after reading.' },
    },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => {
          const v = value ?? {}
          const lines = []
          lines.push(`ok: ${v.ok === true ? 'true' : 'false'}`)
          if (v.channel) lines.push(`channel: ${v.channel}`)
          if (v.paused !== undefined) lines.push(`paused: ${v.paused ? 'true' : 'false'}`)
          if (v.message && v.message.text) lines.push(`comment: ${v.message.text}`)
          if (Array.isArray(v.messages)) {
            lines.push(`messages: ${v.messages.length}`)
            v.messages.forEach((m, i) => lines.push(`${i + 1}. ${m.text || JSON.stringify(m)}`))
          }
          if (v.error) lines.push(`error: ${v.error}`)
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
    execute: async (args) => {
      const channel = String(args.channel || '').trim()
      if (!channel) return { ok: false, error: 'channel is required' }
      const messages = messagesOf(channel).slice()
      if (args.clear === true) channelMessages.set(channel, [])
      return { ok: true, channel, paused: isChannelPaused(channel), messages }
    },
  }))

  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (httpCtx) => {
      httpCtx.effect?.(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/agent-review-roundtable/progress',
          handler: async (req, res) => {
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ active: progressEvents.length > 0, events: progressEvents.slice(-50) }))
          },
        }),
        'agent-review-roundtable: progress state',
      )

        httpCtx.effect?.(
          () => httpCtx.webServer.register({
            kind: 'exact',
            path: '/plugins/agent-review-roundtable/last-result',
            handler: async (req, res) => {
              res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify(lastResult || {}))
            },
          }),
          'agent-review-roundtable: last result',
        )

        const readJsonBody = async (req) => {
          const chunks = []
          for await (const chunk of req) chunks.push(chunk)
          const raw = Buffer.concat(chunks).toString('utf8')
          if (!raw) return {}
          try { return JSON.parse(raw) } catch (err) { return {} }
        }

        const pauseHandler = async (req, res) => {
          const body = await readJsonBody(req)
          const channel = String(body.channel || '').trim()
          if (!channel) { res.writeHead(400); res.end('channel required'); return }
          setChannelPaused(channel, true)
          emitProgress({ type: 'pause_requested', channel, text: `UI 请求暂停 channel ${channel}` })
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, paused: true, channel }))
        }

        const resumeHandler = async (req, res) => {
          const body = await readJsonBody(req)
          const channel = String(body.channel || '').trim()
          if (!channel) { res.writeHead(400); res.end('channel required'); return }
          setChannelPaused(channel, false)
          emitProgress({ type: 'resume_requested', channel, text: `UI 已恢复 channel ${channel}` })
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, paused: false, channel }))
        }

        httpCtx.effect?.(
          () => httpCtx.webServer.register({ kind: 'exact', path: '/plugins/agent-review-roundtable/pause', handler: pauseHandler }),
          'agent-review-roundtable: pause',
        )
        httpCtx.effect?.(
          () => httpCtx.webServer.register({ kind: 'exact', path: '/plugins/agent-review-roundtable/resume', handler: resumeHandler }),
          'agent-review-roundtable: resume',
        )

        const commentHandler = async (req, res) => {
          const body = await readJsonBody(req)
          const channel = String(body.channel || '').trim()
          const text = String(body.text || '').trim()
          if (!channel || !text) { res.writeHead(400); res.end('channel and text required'); return }
          const msg = { channel, text, from: 'UI', time: Date.now() }
          messagesOf(channel).push(msg)
          emitProgress({ type: 'comment', channel, text: `[UI] ${text}` })
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, message: msg }))
        }
        httpCtx.effect?.(
          () => httpCtx.webServer.register({ kind: 'exact', path: '/plugins/agent-review-roundtable/comment', handler: commentHandler }),
          'agent-review-roundtable: comment',
        )

        const polishHandler = async (req, res) => {
          await loadProjectEnv()
          const body = await readJsonBody(req)
          const text = String(body.text || '').trim()
          if (!text) {
            res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false, error: 'text is required' }))
            return
          }
          const apiKey = await resolveApiKey()
          if (!apiKey) {
            res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false, error: 'Missing LLM_API_KEY. Set LLM_API_KEY or DEEPSEEK_API_KEY credential.' }))
            return
          }
          const instruction =
            typeof body.instruction === 'string' && body.instruction.trim()
              ? body.instruction.trim()
              : undefined
          const context =
            typeof body.context === 'string' && body.context.trim()
              ? body.context.trim()
              : undefined
          try {
            const result = await polishPrompt({
              text,
              instruction,
              context,
              apiKey,
              baseUrl: process.env.LLM_BASE_URL ?? 'https://api.deepseek.com/v1',
              model:
                process.env.LLM_PROMPT_MODEL ??
                process.env.LLM_CORE_MODEL ??
                'deepseek-chat',
            })
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: true, text: result.text, feedback: result.feedback, model: result.model, usage: result.usage }))
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false, error: message }))
          }
        }
        httpCtx.effect?.(
          () => httpCtx.webServer.register({ kind: 'exact', path: '/plugins/agent-review-roundtable/polish', handler: polishHandler }),
          'agent-review-roundtable: polish',
        )


        const setupStatusHandler = async (req, res) => {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ configured: setupConfigured }))
        }

        const setupSaveHandler = async (req, res) => {
          const body = await readJsonBody(req)
          const apiKey = String(body.apiKey || '').trim()
          const baseUrl = String(body.baseUrl || 'https://api.deepseek.com/v1').trim()
          const model = String(body.model || 'deepseek-chat').trim()
          if (Array.isArray(body.roles)) {
            body.roles.forEach((r) => {
              if (r && r.id) {
                roleOverrides.set(String(r.id), {
                  model: String(r.model || model),
                  baseUrl: String(r.baseUrl || baseUrl),
                })
              }
            })
          }
          if (!apiKey) { res.writeHead(400); res.end('apiKey required'); return }
          process.env.LLM_API_KEY = apiKey
          process.env.LLM_BASE_URL = baseUrl
          process.env.LLM_CORE_MODEL = process.env.LLM_CORE_MODEL || model
          process.env.LLM_AUX_MODEL = process.env.LLM_AUX_MODEL || model
          process.env.ART_CONFIGURED = '1'
          setupConfigured = true
          try {
            // Persist global + per-role settings to .env so they survive a
            // plugin restart and are shared with CLI runs (which load .env).
            const updates = {
              LLM_API_KEY: apiKey,
              LLM_BASE_URL: baseUrl,
              LLM_CORE_MODEL: process.env.LLM_CORE_MODEL || model,
              LLM_AUX_MODEL: process.env.LLM_AUX_MODEL || model,
            }
            for (const [roleId, override] of roleOverrides) {
              const key = String(roleId).toUpperCase()
              updates[`LLM_ROLE_${key}_MODEL`] = override.model
              updates[`LLM_ROLE_${key}_BASE_URL`] = override.baseUrl
            }
            const envBody = await mergeDotEnv(new URL('../.env', import.meta.url), updates)
            await writeFile(new URL('../.env', import.meta.url), envBody, 'utf8')
          } catch (error) {
            // If the package directory is not writable, keep in-memory config only.
          }
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, configured: true }))
        }

        httpCtx.effect?.(
          () => httpCtx.webServer.register({ kind: 'exact', path: '/plugins/agent-review-roundtable/setup', handler: setupStatusHandler }),
          'agent-review-roundtable: setup status',
        )
        httpCtx.effect?.(
          () => httpCtx.webServer.register({ kind: 'exact', path: '/plugins/agent-review-roundtable/setup/save', handler: setupSaveHandler }),
          'agent-review-roundtable: setup save',
        )


      httpCtx.effect?.(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/agent-review-roundtable/events',
          handler: async (req, res) => {
            res.writeHead(200, {
              'content-type': 'text/event-stream; charset=utf-8',
              'cache-control': 'no-cache',
              connection: 'keep-alive',
            })
            res.write('retry: 1000\n\n')
            const send = (event) => {
              res.write(`data: ${JSON.stringify(event)}\n\n`)
            }
            progressListeners.add(send)
            req.on('close', () => progressListeners.delete(send))
          },
        }),
        'agent-review-roundtable: SSE events',
      )

      httpCtx.effect?.(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/agent-review-roundtable/progress.html',
          handler: async (req, res) => {
            try {
              const html = await readFile(new URL('./progress.html', import.meta.url), 'utf8')
              res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
              res.end(html)
            } catch (err) {
              res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
              res.end(String(err && err.message ? err.message : err))
            }
          },
        }),
        'agent-review-roundtable: progress page',
      )

      httpCtx.effect?.(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/agent-review-roundtable/avatar.svg',
          handler: async (req, res) => {
            try {
              const svg = await readFile(new URL('./avatar.svg', import.meta.url))
              res.writeHead(200, {
                'content-type': 'image/svg+xml; charset=utf-8',
                'cache-control': 'public, max-age=3600',
              })
              res.end(svg)
            } catch (err) {
              res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
              res.end('avatar.svg not found')
            }
          },
        }),
        'agent-review-roundtable: avatar',
      )

    })
  }

  // Optional: surface a "review ready" hint after a chat turn ends.
  // Guarded by env ART_AUTO_REVIEW=1 so it is inert unless explicitly enabled.
  if (typeof ctx.on === 'function' && process.env.ART_AUTO_REVIEW === '1') {
    ctx.on('session/event', (session, event) => {
      const type = event && event.type
      if (type !== 'turn/end') return
      const cwd = (session && (session.header?.cwd || session.cwd)) || undefined
      if (!cwd) return
      emitProgress({
        type: 'auto_review_ready',
        text: `检测到回合结束，可自动评审：${cwd}`,
        cwd,
      })
    }, { global: true })
  }
}

function clampInt(value, fallback, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}
