/**
 * Agent Review Roundtable — DSH Web client overlay + composer backfeed.
 *
 * 1. Shows live review progress in a small fixed panel at the bottom-right.
 * 2. Registers composer buttons:
 *    - "↩️ 回灌" fetches the last review action prompt and writes it into input;
 *    - "✨ 润色" sends the current draft to the host /polish endpoint and writes
 *      the improved prompt back into input.
 *
 * This file is a hand-maintained __ModuleLoader__.load bundle.
 */
window.__ModuleLoader__.load({
  id: 'agent-review-roundtable',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    var React = require('react')

    var PLUGIN = 'agent-review-roundtable'
    var PANEL_ID = 'agent-review-roundtable-live'
    var STYLE_ID = 'agent-review-roundtable-style'
    var BACKFEED_ID = 'agent-review-roundtable-backfeed'
    var POLISH_ID = 'agent-review-roundtable-polish'
    var LAST_RESULT_URL = '/plugins/agent-review-roundtable/last-result'
    var POLISH_URL = '/plugins/agent-review-roundtable/polish'
    var COMMENT_URL = '/plugins/agent-review-roundtable/comment'
    var currentChannel = null
    var lastClientResult = null
    var inputActionsRef = null

    function ensureStyle() {
      if (document.getElementById(STYLE_ID)) return
      var style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = [
        '#' + PANEL_ID + '{position:fixed;right:16px;bottom:16px;z-index:2147483000;width:280px;max-height:320px;overflow:auto;border:1px solid rgba(127,127,127,.35);border-radius:12px;background:rgba(15,17,21,.92);color:#e6e9f0;font:12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:10px 12px;box-shadow:0 8px 30px rgba(0,0,0,.3);display:none}',
        '#' + PANEL_ID + '[data-active="true"]{display:block}',
        '#' + PANEL_ID + '[data-docked="true"]{right:0;bottom:0;top:0;width:380px;max-height:none;height:auto;border-radius:0;border-left:1px solid rgba(127,127,127,.4);border-bottom:none;box-shadow:-8px 0 30px rgba(0,0,0,.25)}',
        '#' + PANEL_ID + ' .art-header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;cursor:move;user-select:none}',
        '#' + PANEL_ID + ' .art-dock-btn,#' + PANEL_ID + ' .art-close-btn{border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;border-radius:6px;padding:2px 8px;font-size:11px;cursor:pointer}',
        '#' + PANEL_ID + ' .art-resize-handle{position:absolute;left:0;top:0;bottom:0;width:6px;cursor:ew-resize;display:none}',
        '#' + PANEL_ID + '[data-docked="true"] .art-resize-handle{display:block}',
        '#' + PANEL_ID + ' .art-title{font-weight:600;margin-bottom:6px}',
        '#' + PANEL_ID + ' .art-event{border-top:1px solid rgba(127,127,127,.18);padding-top:5px;margin-top:5px;white-space:pre-wrap}',
        '#' + PANEL_ID + ' .art-empty{color:#8b93a7}',
        '#' + PANEL_ID + ' #art-events{max-height:220px;overflow:auto}',
        '#' + PANEL_ID + '[data-docked="true"] #art-events{max-height:none}',
        '#' + BACKFEED_ID + ',#' + POLISH_ID + '{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 8px;border:1px solid rgba(127,127,127,.35);border-radius:6px;background:transparent;color:inherit;font-size:12px;cursor:pointer;white-space:nowrap}',
        '#' + BACKFEED_ID + ':hover:not(:disabled),#' + POLISH_ID + ':hover:not(:disabled){border-color:#4a7cff;background:rgba(74,124,255,.12)}',
        '#' + BACKFEED_ID + ':disabled,#' + POLISH_ID + ':disabled{opacity:.5;cursor:not-allowed}',
        '#' + PANEL_ID + ' .art-controls{display:flex;gap:6px;margin-top:8px}',
        '#' + PANEL_ID + ' .art-btn{flex:1;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;border-radius:6px;padding:4px 6px;font-size:11px;cursor:pointer}',
        '#' + PANEL_ID + ' .art-btn:disabled{opacity:.5;cursor:not-allowed}',
        '#' + PANEL_ID + '{background:var(--dsw-alias-bg-layer-1,rgba(15,17,21,.94));color:var(--dsw-alias-label-primary,#e6e9f0)}',
        '#' + PANEL_ID + '[data-ambient="whale-aquarium"]{background:rgba(8,28,40,.95);color:#dff6ff}',
        '#' + PANEL_ID + '[data-ambient="aurora"]{background:linear-gradient(135deg,#12121a,#241b33);color:#e8e6f0}',
        '#' + PANEL_ID + ' .art-status{color:#8b93a7;padding:4px 8px;font-size:11px;border-bottom:1px solid rgba(127,127,127,.15)}',
        '#' + PANEL_ID + ' .art-launch{display:flex;gap:6px;padding:6px 8px;border-bottom:1px solid rgba(127,127,127,.12)}',
        '#' + PANEL_ID + ' .art-launch input{flex:1;min-width:0;background:#0b0d12;border:1px solid rgba(127,127,127,.3);border-radius:6px;color:inherit;padding:4px 6px;font-size:12px}',
        '#' + PANEL_ID + ' .art-result{border-top:1px solid rgba(127,127,127,.15);padding:8px;max-height:160px;overflow:auto}',
        '#' + PANEL_ID + ' .art-result h4{margin:0 0 6px}',
        '#' + PANEL_ID + ' .art-result .art-summary{white-space:pre-wrap;margin-bottom:6px}',
        '#' + PANEL_ID + ' .art-comment{display:flex;gap:6px;padding:6px 8px}',
        '#' + PANEL_ID + ' .art-comment input{flex:1;min-width:0;background:#0b0d12;border:1px solid rgba(127,127,127,.3);border-radius:6px;color:inherit;padding:4px 6px;font-size:12px}'
      ].join('')
      document.head.appendChild(style)
    }

    function ensurePanel() {
      var panel = document.getElementById(PANEL_ID)
      if (panel) return panel
      panel = document.createElement('div')
      panel.id = PANEL_ID
      panel.setAttribute('data-active', 'false')
      panel.innerHTML = '<div id="art-resize" class="art-resize-handle"></div><div class="art-header"><span class="art-title">🪑 Agent Review Roundtable</span><span style="display:inline-flex;gap:6px"><button id="art-dock-toggle" class="art-dock-btn" title="停靠/浮层切换">📌 停靠</button><button id="art-settings-btn" class="art-dock-btn" title="设置 API Key / 供应商 / 角色模型">⚙️</button><button id="art-close-btn" class="art-close-btn" title="关闭面板">✕</button></span></div><div id="art-status" class="art-status">等待评审任务…</div><div class="art-launch"><input id="art-launch-input" placeholder="仓库路径 或 .patch 文件路径" /><button id="art-launch-btn" class="art-btn">🚀 启动评审</button></div><div id="art-events"><div class="art-empty">等待评审任务…</div></div><div id="art-result" class="art-result" style="display:none"></div><div class="art-controls" style="display:none"><button id="art-pause" class="art-btn">⏸ 暂停</button><button id="art-resume" class="art-btn">▶ 恢复</button><button id="art-copy-action" class="art-btn" disabled>复制回灌</button><button id="art-copy-json" class="art-btn" disabled>复制 JSON</button><button id="art-clear" class="art-btn">清空</button></div><div class="art-comment"><input id="art-comment-input" placeholder="给当前 channel 发评论…" disabled /><button id="art-comment-send" class="art-btn" disabled>发送</button></div>'
      document.body.appendChild(panel)
        try {
          var ambient = localStorage.getItem('dsh.ambient.background') || ''
          if (ambient) panel.setAttribute('data-ambient', ambient)
        } catch (e) {}

      return panel
    }

    function appendEvent(text) {
      var panel = ensurePanel()
      panel.setAttribute('data-active', 'true')
      var container = document.getElementById('art-events')
      if (!container) return
      var empty = container.querySelector('.art-empty')
      if (empty) empty.remove()
      var div = document.createElement('div')
      div.className = 'art-event'
      div.textContent = text
      container.appendChild(div)
      while (container.children.length > 12) {
        var first = container.children[0]
        if (first) container.removeChild(first)
        else break
      }
    }

    function setStatus(text) {
      var el = document.getElementById('art-status')
      if (el) el.textContent = text
    }

    function clearEvents() {
      var container = document.getElementById('art-events')
      if (container) container.innerHTML = ''
      appendEvent('进度已清空')
    }

    function renderResult(result) {
      lastClientResult = result
      var area = document.getElementById('art-result')
      if (!area) return
      area.innerHTML = ''
      area.style.display = ''
      var h = document.createElement('h4')
      h.textContent = '📋 Review Result'
      area.appendChild(h)
      var summary = document.createElement('div')
      summary.className = 'art-summary'
      summary.textContent = result.summary || '（无总结）'
      area.appendChild(summary)
      if (result.blocking && result.blocking.length) {
        var bTitle = document.createElement('div')
        bTitle.textContent = 'Blocking:'
        area.appendChild(bTitle)
        var bList = document.createElement('ul')
        result.blocking.forEach(function (item) {
          var li = document.createElement('li')
          li.textContent = item
          bList.appendChild(li)
        })
        area.appendChild(bList)
      }
      if (result.action_items && result.action_items.length) {
        var aTitle = document.createElement('div')
        aTitle.textContent = 'Action Items:'
        area.appendChild(aTitle)
        var aList = document.createElement('ul')
        result.action_items.forEach(function (item) {
          var li = document.createElement('li')
          li.textContent = item
          aList.appendChild(li)
        })
        area.appendChild(aList)
      }
      var copyAction = document.getElementById('art-copy-action')
      var copyJson = document.getElementById('art-copy-json')
      if (copyAction) copyAction.disabled = false
      if (copyJson) copyJson.disabled = false
      setStatus('评审完成，可回灌或复制结果')
    }

    function sendComment() {
      var input = document.getElementById('art-comment-input')
      if (!currentChannel || !input || !input.value.trim()) return
      fetch(COMMENT_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channel: currentChannel, text: input.value.trim() }),
      }).catch(function () {})
      input.value = ''
    }

    function copyText(text) {
      if (!text) return
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(function () {})
      } else {
        var ta = document.createElement('textarea')
        ta.value = text
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        ta.remove()
      }
    }

    function resetPanel() {
      var panel = ensurePanel()
      var container = document.getElementById('art-events')
      if (container) {
        container.innerHTML = ''
        var empty = document.createElement('div')
        empty.className = 'art-empty'
        empty.textContent = '等待评审任务…'
        container.appendChild(empty)
      }
      panel.setAttribute('data-active', 'false')
      currentChannel = null
      updateControls()
    }

    function updateControls() {
      var panel = ensurePanel()
      var controls = panel.querySelector('.art-controls')
      var pauseBtn = document.getElementById('art-pause')
      var resumeBtn = document.getElementById('art-resume')
      var commentInput = document.getElementById('art-comment-input')
      var commentSend = document.getElementById('art-comment-send')
      if (!controls || !pauseBtn || !resumeBtn) return
      if (currentChannel) {
        controls.style.display = 'flex'
        pauseBtn.disabled = false
        resumeBtn.disabled = false
        if (commentInput) commentInput.disabled = false
        if (commentSend) commentSend.disabled = false
        setStatus('Channel: ' + currentChannel)
      } else {
        controls.style.display = 'flex'
        pauseBtn.disabled = true
        resumeBtn.disabled = true
        if (commentInput) commentInput.disabled = true
        if (commentSend) commentSend.disabled = true
      }
    }

    function launchReview() {
      var input = document.getElementById('art-launch-input')
      var target = input ? input.value.trim() : ''
      if (!target) {
        target = 'samples/prompt-polish-client.patch'
        if (input) input.value = target
      }
      var prompt
      if (/\.(patch|diff)$/i.test(target)) {
        prompt = '请调用 agent_review_roundtable 评审 diff 文件：' + target
      } else {
        prompt = '请调用 agent_review_roundtable 评审目标：' + target + '。如果是 git 仓库请用 repo 参数；如果不是 git 仓库请用 directory 参数。'
      }
      if (inputActionsRef && typeof inputActionsRef.setDraft === 'function') {
        inputActionsRef.setDraft(prompt)
        setStatus('评审指令已写入输入框，请发送')
      } else {
        copyText(prompt)
        setStatus('未找到输入框，评审指令已复制')
      }
    }

    function toggleDock() {
      var panel = ensurePanel()
      var docked = panel.getAttribute('data-docked') === 'true'
      var next = docked ? 'false' : 'true'
      panel.setAttribute('data-docked', next)
      var btn = document.getElementById('art-dock-toggle')
      if (btn) btn.textContent = docked ? '📌 停靠' : '📌 收起'
      if (next === 'true') {
        panel.style.right = '0px'
        panel.style.bottom = '0px'
        panel.style.top = '0px'
        panel.style.left = 'auto'
        panel.style.width = '380px'
      } else {
        panel.style.top = 'auto'
        panel.style.bottom = '16px'
        panel.style.right = '16px'
        panel.style.left = 'auto'
        panel.style.width = '280px'
      }
    }

    function closePanel() {
      var panel = ensurePanel()
      panel.setAttribute('data-active', 'false')
      currentChannel = null
      updateControls()
    }

    function startDrag(e) {
      var panel = ensurePanel()
      if (panel.getAttribute('data-docked') === 'true') return
      if (!panel.style.left || panel.style.left === 'auto') {
        var rect = panel.getBoundingClientRect()
        panel.style.left = rect.left + 'px'
        panel.style.top = rect.top + 'px'
        panel.style.right = 'auto'
        panel.style.bottom = 'auto'
      }
      var startX = e.clientX
      var startY = e.clientY
      var origLeft = parseInt(panel.style.left, 10)
      var origTop = parseInt(panel.style.top, 10)
      function onMove(ev) {
        panel.style.left = Math.max(0, Math.min(window.innerWidth - 80, origLeft + ev.clientX - startX)) + 'px'
        panel.style.top = Math.max(0, Math.min(window.innerHeight - 40, origTop + ev.clientY - startY)) + 'px'
      }
      function onUp() {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      e.preventDefault()
    }

    function startResize(e) {
      var panel = ensurePanel()
      if (panel.getAttribute('data-docked') !== 'true') return
      var startX = e.clientX
      var startWidth = panel.offsetWidth
      function onMove(ev) {
        var nextWidth = Math.max(260, Math.min(720, startWidth + (startX - ev.clientX)))
        panel.style.width = nextWidth + 'px'
      }
      function onUp() {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      e.preventDefault()
    }

    function sendControl(action) {
      if (!currentChannel) return
      fetch('/plugins/agent-review-roundtable/' + action, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channel: currentChannel }),
      }).catch(function () {})
    }

    function BackfeedButton(props) {
      var inputActions = props.inputActions
      inputActionsRef = inputActions || inputActionsRef
      var busyState = React.useState(false)
      var busy = busyState[0]
      var setBusy = busyState[1]
      var errorState = React.useState(null)
      var error = errorState[0]
      var setError = errorState[1]

      function onBackfeed() {
        if (busy || !inputActions || typeof inputActions.setDraft !== 'function') return
        setBusy(true)
        setError(null)
        fetch(LAST_RESULT_URL)
          .then(function (res) { return res.json() })
          .then(function (data) {
            if (data && data.action_prompt) {
              inputActions.setDraft(data.action_prompt)
            } else {
              setError('还没有可回灌的评审结果')
            }
          })
          .catch(function (err) { setError(String(err && err.message ? err.message : err)) })
          .finally(function () { setBusy(false) })
      }

      return React.createElement(
        'button',
        {
          id: BACKFEED_ID,
          type: 'button',
          disabled: busy,
          onClick: onBackfeed,
          title: '将最近一次评审的 Action Items 写入输入框',
        },
        busy ? '…' : '↩️ 回灌',
        error ? React.createElement('span', { style: { color: '#e5484d', marginLeft: 4, fontSize: 11 } }, error) : null
      )
    }

      function PolishButton(props) {
        var inputActions = props.inputActions
        inputActionsRef = inputActions || inputActionsRef
        var draftState = props.useInput(function (state) {
          return state && state.draft ? state.draft : ''
        })
        var busyState = React.useState(false)
        var busy = busyState[0]
        var setBusy = busyState[1]
        var errorState = React.useState(null)
        var error = errorState[0]
        var setError = errorState[1]
        var text = (draftState || '').trim()
        var disabled = busy || !inputActions || typeof inputActions.setDraft !== 'function' || text.length === 0

        function onPolish() {
          if (disabled) return
          setBusy(true)
          setError(null)
          fetch(POLISH_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: text }),
          })
            .then(function (res) { return res.json() })
            .then(function (data) {
              if (data && data.ok === true && typeof data.text === 'string' && data.text.length > 0) {
                inputActions.setDraft(data.text)
                var feedbackLines = []
                var fb = data.feedback || {}
                if (fb.summary) feedbackLines.push('总结: ' + fb.summary)
                if (Array.isArray(fb.blocking) && fb.blocking.length) {
                  fb.blocking.forEach(function (item) { feedbackLines.push('Blocking: ' + item) })
                }
                if (Array.isArray(fb.suggestions) && fb.suggestions.length) {
                  fb.suggestions.forEach(function (item) { feedbackLines.push('建议: ' + item) })
                }
                if (feedbackLines.length) appendEvent('✨ 润色完成，反馈:\n' + feedbackLines.join('\n'))
              } else {
                setError((data && data.error) ? String(data.error) : '润色失败')
              }
            })
            .catch(function (err) { setError(String(err && err.message ? err.message : err)) })
            .finally(function () { setBusy(false) })
        }

        return React.createElement(
          'button',
          {
            id: POLISH_ID,
            type: 'button',
            disabled: disabled,
            onClick: onPolish,
            title: '将当前输入润色为更清晰、更可执行的提示词（辅助提示词改进）',
          },
          busy ? '…' : '✨ 润色',
          error ? React.createElement('span', { style: { color: '#e5484d', marginLeft: 4, fontSize: 11 } }, error) : null
        )
      }

      function ComposerButtons(props) {
        return React.createElement(
          'span',
          { style: { display: 'inline-flex', alignItems: 'center', gap: '4px' } },
          React.createElement(BackfeedButton, { inputActions: props.inputActions }),
          React.createElement(PolishButton, {
            inputActions: props.inputActions,
            useInput: props.useInput,
          })
        )
      }



    var inject = ['slots']

    function roleProvider(baseUrlDefault) {
      var provider = window.prompt('选择供应商：deepseek / openai / openrouter / custom（默认沿用全局）') || 'default'
      var p = String(provider).toLowerCase().trim()
      if (p === 'openai') return { provider: 'openai', baseUrl: 'https://api.openai.com/v1' }
      if (p === 'openrouter') return { provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' }
      if (p === 'custom') return { provider: 'custom', baseUrl: window.prompt('自定义 Base URL：') || baseUrlDefault }
      return { provider: 'default', baseUrl: baseUrlDefault }
    }

    function reconfigureSettings() {
      var provider = window.prompt('选择全局供应商：deepseek / openai / openrouter / custom（默认 deepseek）') || 'deepseek'
      var baseUrl
      var p = String(provider).toLowerCase().trim()
      if (p === 'openai') baseUrl = 'https://api.openai.com/v1'
      else if (p === 'openrouter') baseUrl = 'https://openrouter.ai/api/v1'
      else if (p === 'custom') baseUrl = window.prompt('请输入自定义 Base URL：') || 'https://api.deepseek.com/v1'
      else baseUrl = 'https://api.deepseek.com/v1'

      var apiKey = window.prompt('请输入新的 LLM API Key：')
      if (!apiKey) return
      var model = window.prompt('请输入默认模型名称（默认 deepseek-chat）：') || 'deepseek-chat'

      var roles = []
      var adjust = window.prompt('是否单独调整各角色模型/供应商？（y=是，直接回车=跳过）')
      if (/^y/i.test(adjust || '')) {
        var roleIds = ['architect', 'security', 'tester', 'maintainer']
        roleIds.forEach(function (id) {
          var roleModel = window.prompt('角色 ' + id + ' 的模型（回车=沿用默认 ' + model + '）') || model
          var rp = roleProvider(baseUrl)
          roles.push({ id: id, model: roleModel, provider: rp.provider, baseUrl: rp.baseUrl })
        })
      }

      fetch('/plugins/agent-review-roundtable/setup/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey, model: model, baseUrl: baseUrl, roles: roles }),
      })
        .then(function (res) { return res.json() })
        .then(function (data) { appendEvent(data && data.ok ? '设置已更新' : '设置更新失败') })
        .catch(function () { appendEvent('设置更新失败') })
    }

    function apply(ctx) {
      ensureStyle()
      ensurePanel()

      var source = null
      function connect() {
        if (source) source.close()
        try {
          source = new EventSource('/plugins/agent-review-roundtable/events')
        } catch (e) {
          appendEvent('SSE 连接失败: ' + e.message)
          return
        }
        source.onopen = function () { appendEvent('已连接实时进度') }
        source.onmessage = function (e) {
          var data
          try {
            data = JSON.parse(e.data)
          } catch (err) {
            appendEvent(String(e.data))
            return
          }
          var time = data.time ? new Date(data.time).toLocaleTimeString() : ''
          var label = (time ? time + ' ' : '') + (data.text || JSON.stringify(data))
          if (data.type === 'start') {
            // A new review began: adopt its channel and start a clean log.
            currentChannel = data.channel || null
            resetPanel()
            appendEvent(label)
            updateControls()
            return
          }
          // Ignore events that belong to a review running on another channel.
          if (currentChannel && data.channel && data.channel !== currentChannel) return
          if (data.type === 'done' || data.type === 'error') {
            // Review finished or failed: hide pause/resume so a stale channel
            // cannot be paused afterwards and stall the next review on it.
            appendEvent(label)
            currentChannel = null
            updateControls()
            return
          }
          appendEvent(label)
          updateControls()
        }
        source.onerror = function () { /* keep silent or reconnect later */ }
      }
      connect()
      window.addEventListener('beforeunload', function () { if (source) source.close() })

        var pauseBtn = document.getElementById('art-pause')
        var resumeBtn = document.getElementById('art-resume')
        if (pauseBtn) pauseBtn.addEventListener('click', function () { sendControl('pause') })
        if (resumeBtn) resumeBtn.addEventListener('click', function () { sendControl('resume') })
        updateControls()

        var dockBtn = document.getElementById('art-dock-toggle')
        if (dockBtn) dockBtn.addEventListener('click', toggleDock)

        var closeBtn = document.getElementById('art-close-btn')
        if (closeBtn) closeBtn.addEventListener('click', closePanel)
        var settingsBtn = document.getElementById('art-settings-btn')
        if (settingsBtn) settingsBtn.addEventListener('click', reconfigureSettings)

        var header = ensurePanel().querySelector('.art-header')
        if (header) header.addEventListener('pointerdown', startDrag)
        var resize = document.getElementById('art-resize')
        if (resize) resize.addEventListener('pointerdown', startResize)

        var copyAction = document.getElementById('art-copy-action')
        var copyJson = document.getElementById('art-copy-json')
        var clearBtn = document.getElementById('art-clear')
        var commentSend = document.getElementById('art-comment-send')
        var commentInput = document.getElementById('art-comment-input')
        if (copyAction) copyAction.addEventListener('click', function () {
          if (lastClientResult && lastClientResult.action_prompt) copyText(lastClientResult.action_prompt)
        })
        if (copyJson) copyJson.addEventListener('click', function () {
          if (lastClientResult) copyText(JSON.stringify(lastClientResult, null, 2))
        })
        if (clearBtn) clearBtn.addEventListener('click', clearEvents)
        if (commentSend) commentSend.addEventListener('click', sendComment)
        if (commentInput) commentInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') sendComment() })
        var launchBtn = document.getElementById('art-launch-btn')
        var launchInput = document.getElementById('art-launch-input')
        if (launchBtn) launchBtn.addEventListener('click', launchReview)
        if (launchInput) launchInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') launchReview() })






      var slots = ctx && ctx.get ? ctx.get('slots') : ctx && ctx.slots
      if (slots) {
        slots.inject('conversation.input.right', function () {
          return slots.register(
            {
              name: 'conversation.input.right',
              id: BACKFEED_ID,
              order: 500,
              label: '评审回灌 / 润色',
            },
            function (props) {
              return React.createElement(ComposerButtons, {
                inputActions: props.inputActions,
                useInput: props.useInput,
              })
            }
          )
        })
      }
    }

    exports.name = PLUGIN
    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
