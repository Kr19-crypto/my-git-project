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
    var MANUAL_ID = 'agent-review-roundtable-manual'
    var AVATAR_ID = 'agent-review-roundtable-avatar'
    var AVATAR_URL = '/plugins/agent-review-roundtable/avatar.svg'
    var LAST_RESULT_URL = '/plugins/agent-review-roundtable/last-result'
    var POLISH_URL = '/plugins/agent-review-roundtable/polish'
    var COMMENT_URL = '/plugins/agent-review-roundtable/comment'
    var currentChannel = null
    var lastClientResult = null
    var inputActionsRef = null
    var avatarSizeHeight = 100
    var avatarSizeRatio = 0.57

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
        '#' + PANEL_ID + ' .art-comment input{flex:1;min-width:0;background:#0b0d12;border:1px solid rgba(127,127,127,.3);border-radius:6px;color:inherit;padding:4px 6px;font-size:12px}',
        '#' + AVATAR_ID + '{display:none;align-items:center;gap:10px;margin:8px 0;padding:8px 10px;border:1px solid rgba(127,127,127,.3);border-radius:12px;background:rgba(255,255,255,.04)}',
        '#' + AVATAR_ID + '[data-active="true"]{display:flex}',
        '#' + AVATAR_ID + ' .art-avatar-figure{position:relative;flex:0 0 auto;width:57px;height:100px;min-width:36px;min-height:64px;max-width:140px;max-height:220px}',
        '#' + AVATAR_ID + ' .art-avatar-img{display:block;width:100%;height:100%;object-fit:contain;object-position:center bottom;filter:drop-shadow(0 4px 8px rgba(0,0,0,.4));animation:artAvatarFloat 1.4s ease-in-out infinite alternate;pointer-events:none}',
        '#' + AVATAR_ID + ' .art-avatar-resize{position:absolute;right:-2px;bottom:-2px;width:14px;height:14px;cursor:nwse-resize;touch-action:none;border-right:2px solid rgba(255,255,255,.75);border-bottom:2px solid rgba(255,255,255,.75);border-radius:0 0 6px 0;opacity:.85}',
        '#' + AVATAR_ID + ' .art-avatar-resize:hover{opacity:1;border-color:#4a7cff}',
        '#' + AVATAR_ID + ' .art-avatar-body{min-width:0;flex:1}',
        '#' + AVATAR_ID + ' .art-avatar-role{font-weight:700;margin-bottom:2px;color:#e6e9f0}',
        '#' + AVATAR_ID + ' .art-avatar-text{font-size:11px;line-height:1.5;color:#b9c1cf;white-space:pre-wrap;max-height:76px;overflow:hidden}',
        '@keyframes artAvatarFloat{from{transform:translateY(1px) scale(.99)}to{transform:translateY(-3px) scale(1.02)}}',
        '#' + MANUAL_ID + '{position:fixed;inset:0;z-index:2147483100;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.55);padding:16px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
        '#' + MANUAL_ID + '[data-open="true"]{display:flex}',
        '#' + MANUAL_ID + ' .art-manual-box{background:#171a21;color:#e6e9f0;border:1px solid rgba(127,127,127,.35);border-radius:12px;padding:18px 20px;max-width:560px;max-height:80vh;overflow:auto;line-height:1.65;font-size:13px;box-shadow:0 20px 60px rgba(0,0,0,.45)}',
        '#' + MANUAL_ID + ' .art-manual-header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}',
        '#' + MANUAL_ID + ' h3{margin:0;font-size:16px}',
        '#' + MANUAL_ID + ' h4{margin:14px 0 6px;font-size:13px}',
        '#' + MANUAL_ID + ' p{margin:6px 0}',
        '#' + MANUAL_ID + ' ol,#' + MANUAL_ID + ' ul{margin:6px 0;padding-left:22px}',
        '#' + MANUAL_ID + ' li{margin:5px 0}',
        '#' + MANUAL_ID + ' code{background:#0b0d12;border:1px solid rgba(127,127,127,.25);border-radius:5px;padding:1px 5px;font-family:ui-monospace,Consolas,monospace;font-size:12px;overflow-wrap:anywhere}',
        '#' + MANUAL_ID + ' .art-manual-note{color:#8b93a7;font-size:12px}',
        '#' + MANUAL_ID + ' .art-close-btn{border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;border-radius:6px;padding:2px 8px;font-size:12px;cursor:pointer}'
      ].join('')
      document.head.appendChild(style)
    }

    function ensurePanel() {
      var panel = document.getElementById(PANEL_ID)
      if (panel) return panel
      panel = document.createElement('div')
      panel.id = PANEL_ID
      panel.setAttribute('data-active', 'false')
      panel.innerHTML = '<div id="art-resize" class="art-resize-handle"></div><div class="art-header"><span class="art-title">🪑 Agent Review Roundtable</span><span style="display:inline-flex;gap:6px"><button id="art-help-btn" class="art-dock-btn" title="功能简介 / 使用说明">📖</button><button id="art-dock-toggle" class="art-dock-btn" title="停靠/浮层切换">📌 停靠</button><button id="art-settings-btn" class="art-dock-btn" title="设置 API Key / 供应商 / 角色模型">⚙️</button><button id="art-close-btn" class="art-close-btn" title="关闭面板">✕</button></span></div><div id="art-status" class="art-status">等待评审任务…</div><div class="art-launch"><input id="art-launch-input" placeholder="仓库路径 或 .patch 文件路径" /><button id="art-launch-btn" class="art-btn">🚀 启动评审</button></div><div id="' + AVATAR_ID + '"></div><div id="art-events"><div class="art-empty">等待评审任务…</div></div><div id="art-result" class="art-result" style="display:none"></div><div class="art-controls" style="display:none"><button id="art-pause" class="art-btn">⏸ 暂停</button><button id="art-resume" class="art-btn">▶ 恢复</button><button id="art-copy-action" class="art-btn" disabled>复制回灌</button><button id="art-copy-json" class="art-btn" disabled>复制 JSON</button><button id="art-clear" class="art-btn">清空</button></div><div class="art-comment"><input id="art-comment-input" placeholder="给当前 channel 发评论…" disabled /><button id="art-comment-send" class="art-btn" disabled>发送</button></div>'
      document.body.appendChild(panel)
        try {
          var ambient = localStorage.getItem('dsh.ambient.background') || ''
          if (ambient) panel.setAttribute('data-ambient', ambient)
        } catch (e) {}

      return panel
    }

    function ensureManual() {
      var manual = document.getElementById(MANUAL_ID)
      if (manual) return manual
      manual = document.createElement('div')
      manual.id = MANUAL_ID
      manual.innerHTML =
        '<div class="art-manual-box">' +
        '<div class="art-manual-header"><h3>🪑 Agent Review Roundtable 功能简介 / 使用说明</h3><button id="art-manual-close" class="art-close-btn" type="button">✕</button></div>' +
        '<p><strong>这是什么？</strong> 它用多个 AI 角色（架构师 / 安全 / 测试 / 维护者）对代码 diff 做“圆桌评审”，输出结构化问题清单与下一步行动项。</p>' +
        '<h4>📥 这个面板怎么用？</h4>' +
        '<ol>' +
        '<li>在上方输入框中填写本地 <code>git 仓库路径</code> 或 <code>.patch/.diff 文件路径</code>；</li>' +
        '<li>点击 <strong>🚀 启动评审</strong>，面板会把评审指令写入 DSH 输入框；</li>' +
        '<li>发送该指令，Agent 会调用 <code>agent_review_roundtable</code> 执行评审；</li>' +
        '<li>面板实时显示评审进度；完成后可 <strong>复制回灌</strong> / <strong>复制 JSON</strong>。</li>' +
        '</ol>' +
        '<h4>✨ 还能做什么？</h4>' +
        '<ul>' +
        '<li><strong>✨ 润色</strong>：把当前草稿提示词改得更清晰、可执行（输入框右侧按钮）。</li>' +
        '<li><strong>↩️ 回灌</strong>：评审完成后，把 Action Items 一键写回 DSH 输入框（输入框右侧按钮）。</li>' +
        '<li><strong>⚙️ 设置</strong>：配置 API Key、供应商、默认模型或各角色模型。</li>' +
        '<li><strong>⏸ 暂停 / ▶ 恢复 / 💬 评论</strong>：用于多会话 A/B 协作评审。</li>' +
        '</ul>' +
        '<p class="art-manual-note">提示：没有 LLM API Key 时，可先用 <code>⚙️</code> 设置；命令行用户也可以直接运行 <code>node dist/cli.js review --repo &lt;路径&gt; --yes</code>。</p>' +
        '</div>'
      document.body.appendChild(manual)
      var closeBtn = document.getElementById('art-manual-close')
      if (closeBtn) closeBtn.addEventListener('click', hideManual)
      manual.addEventListener('click', function (e) {
        if (e.target === manual) hideManual()
      })
      return manual
    }

    function showManual() {
      ensureManual().setAttribute('data-open', 'true')
    }

    function hideManual() {
      var manual = document.getElementById(MANUAL_ID)
      if (manual) manual.setAttribute('data-open', 'false')
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

    function hideAvatar() {
      var el = document.getElementById(AVATAR_ID)
      if (el) el.setAttribute('data-active', 'false')
    }

    function avatarCoreText(raw, role) {
      var text = raw || ''
      var prefix = role ? role + '：' : ''
      if (prefix && text.indexOf(prefix) === 0) text = text.slice(prefix.length)
      text = text.replace(/\s+/g, ' ').trim()
      if (text.length > 160) text = text.slice(0, 160) + '…'
      return text
    }

    function showAvatar(role, rawText) {
      var el = document.getElementById(AVATAR_ID)
      if (!el) return
      el.innerHTML = ''
      el.setAttribute('data-active', 'true')
      var figure = document.createElement('div')
      figure.className = 'art-avatar-figure'
      var img = document.createElement('img')
      img.className = 'art-avatar-img'
      img.src = AVATAR_URL
      img.alt = role || 'AI 评审角色'
      img.draggable = false
      var handle = document.createElement('span')
      handle.className = 'art-avatar-resize'
      handle.title = '拖拽右下角自由调整虚拟形象大小'
      figure.appendChild(img)
      figure.appendChild(handle)
      figure.style.height = avatarSizeHeight + 'px'
      figure.style.width = Math.round(avatarSizeHeight * avatarSizeRatio) + 'px'
      var body = document.createElement('div')
      body.className = 'art-avatar-body'
      var roleDiv = document.createElement('div')
      roleDiv.className = 'art-avatar-role'
      roleDiv.textContent = role || 'AI 评审角色'
      var textDiv = document.createElement('div')
      textDiv.className = 'art-avatar-text'
      textDiv.textContent = rawText ? avatarCoreText(rawText, role) : '正在思考…'
      body.appendChild(roleDiv)
      body.appendChild(textDiv)
      el.appendChild(figure)
      el.appendChild(body)
      makeAvatarResizable(figure)
    }

    function makeAvatarResizable(figure) {
      if (!figure || figure.getAttribute('data-resizable') === 'true') return
      figure.setAttribute('data-resizable', 'true')
      var handle = figure.querySelector('.art-avatar-resize')
      if (!handle) return
      handle.addEventListener('pointerdown', function (downEv) {
        downEv.preventDefault()
        downEv.stopPropagation()
        var startY = downEv.clientY
        var startWidth = figure.offsetWidth
        var startHeight = figure.offsetHeight
        var ratio = startHeight > 0 ? startWidth / startHeight : 0.57

        function onMove(moveEv) {
          var nextHeight = startHeight + (moveEv.clientY - startY)
          nextHeight = Math.min(220, Math.max(60, nextHeight))
          var nextWidth = Math.round(nextHeight * ratio)
          nextWidth = Math.min(140, Math.max(36, nextWidth))
          figure.style.width = nextWidth + 'px'
          figure.style.height = nextHeight + 'px'
          avatarSizeHeight = nextHeight
          avatarSizeRatio = nextWidth / nextHeight
        }
        function onUp() {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
      })
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
      hideAvatar()
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
            hideAvatar()
            appendEvent(label)
            currentChannel = null
            updateControls()
            return
          }
          if (data.type === 'role_start') {
            showAvatar(data.role || 'AI 评审角色', '')
            appendEvent(label)
            updateControls()
            return
          }
          if (data.type === 'role_speech') {
            showAvatar(data.role || 'AI 评审角色', data.text || '')
            appendEvent(label)
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
        var helpBtn = document.getElementById('art-help-btn')
        if (helpBtn) helpBtn.addEventListener('click', showManual)

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
