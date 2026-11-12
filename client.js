// dsh-deepseek-web — browser half.
//
// A hand-written client bundle: no build step, no JSX, no ESM import/export in
// this file. The page loads it as a script and `window.__ModuleLoader__` supplies
// `require`; React comes from the browser module table.
//
// This plugin does not render a web page of its own. It opens the shipped
// right-Sidebar Browser tab (`@deepseek-ai/dsh-client-ui-sidebar-browser`) at a
// configured HTTPS address. That keeps the host's theme, toolbar, navigation
// history and keyboard habits, and leaves the web app's own conversation flows
// (new chat, typing, streaming replies, resuming) entirely to the web app.
//
// Verified against the implementation shipped in DSH 0.2.2-rc.2:
//   - `ctx.sidebarRight.openTab('browser', { params: { url } })` opens a
//     Browser tab; the URL goes through the same validation as the address bar.
//   - `ctx.sidebarRight.openTabs.getSnapshot()` yields
//     `{ sessionId, tabId, kind, contentId }[]` for every open tab.
//   - `ctx.sidebarRight.focus(tabId)` reveals an existing tab.
//   - Browser declares `multiple: true`, so every `openTab` would otherwise
//     create a fresh tab; reusing an existing one is what preserves a session.
//   - `ctx.slots.inject('conversation.composer.dock', ...)` is the official
//     decoration seat; `ctx.shortcuts.register` and `ctx.configForms.get` are
//     optional services requested at runtime with `ctx.inject`.

window.__ModuleLoader__.load({
  id: 'dsh-deepseek-web',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var React = require('react')
    var h = React.createElement

    var NS = 'dsh-deepseek-web'
    var DICT = 'dshDeepseekWeb'
    var BROWSER_KIND = 'browser'
    var DEFAULT_URL = 'https://chat.deepseek.com'
    var VERIFY_DELAY_MS = 2500

    // ------------------------------------------------------------------ copy

    var zh = {
      open: 'DeepSeek 网页版',
      newTab: '新建标签',
      help: '页面异常',
      opening: '正在打开…',
      retry: '重试',
      diagnostics: '检查项',
      diagnosticsTitle: '加载失败或状态异常时，按顺序检查',
      buttonHint: '在右侧栏打开或回到 DeepSeek 网页版',
      shortcutLabel: '打开 DeepSeek 网页版',
      shortcutDisabled: '该快捷键已在插件配置中关闭。',
      errNoService: '右侧栏服务未就绪，无法打开标签页。',
      errNoBrowser: '内置 Browser 标签页未启用；请在「插件」中启用 dsh-client-ui-sidebar-browser，Web 配置还需在 profile patch 中设置 disabled: false。',
      errNoSession: '当前没有前台会话，右侧栏无法放置标签页；进入一个会话后重试。',
      errBadUrl: '网页地址无效，仅支持不含账号密码的 http/https 地址。',
      errOpenFailed: '打开标签页失败；请确认右侧栏可用后重试。',
      errNotAppeared: '标签页未能创建；右侧栏可能处于折叠或不可用状态。',
      errPageProblem: '页面空白、无法登录或无响应时，按下列检查项处理。',
      errGeneric: '发生未预期的错误，请重试。',
      diag1: '点 Browser 工具栏的「重新载入」；或点上方「新建标签」重新打开该地址。',
      diag2: '若要求重新登录：网页版登录态保存在进程内会话分区，DSH 重启后失效，需要重新登录。',
      diag3: '若站点拒绝嵌入、需要下载或弹窗：点 Browser 工具栏的「在系统浏览器打开」。',
      diag4: '确认网络与系统代理可达；内置 Browser 是真实浏览器导航，不走应用内的 web 工具。',
      diag5: '对话、输入与回复由网页版自身承载；插件不读取、注入或转发网页内容。',
    }

    var en = {
      open: 'DeepSeek Web',
      newTab: 'New tab',
      help: 'Page issue',
      opening: 'Opening…',
      retry: 'Retry',
      diagnostics: 'Checks',
      diagnosticsTitle: 'When loading fails or the tab looks wrong, check in order',
      buttonHint: 'Open or return to the DeepSeek web app in the right sidebar',
      shortcutLabel: 'Open DeepSeek Web',
      shortcutDisabled: 'This shortcut is disabled in the plugin settings.',
      errNoService: 'The right sidebar service is unavailable, so no tab can be opened.',
      errNoBrowser: 'The built-in Browser tab is disabled. Enable dsh-client-ui-sidebar-browser in Plugins; Web profiles also need disabled: false in the profile patch.',
      errNoSession: 'No session is on screen, so the sidebar cannot place a tab. Enter a session and retry.',
      errBadUrl: 'Invalid address. Only http/https URLs without embedded credentials are accepted.',
      errOpenFailed: 'Opening the tab failed; check that the right sidebar is available and retry.',
      errNotAppeared: 'The tab was not created; the sidebar may be collapsed or unavailable.',
      errPageProblem: 'For a blank page, a login loop or no response, follow the checks below.',
      errGeneric: 'Unexpected error; please retry.',
      diag1: 'Use Reload in the Browser toolbar, or press "New tab" above to reopen the address.',
      diag2: 'If asked to sign in again: web login state lives in a process-local partition and is lost when DSH restarts.',
      diag3: 'If the site refuses embedding or needs downloads/popups, use "Open in system browser" in the Browser toolbar.',
      diag4: 'Check network and system proxy reachability. The built-in Browser performs real navigation, not an in-app web fetch.',
      diag5: 'Conversations, input and replies belong to the web app; this plugin never reads, injects or relays page content.',
    }

    /** Bind the dictionary through the locale service, with a language guess as fallback. */
    function makeReader(ctx) {
      try {
        if (ctx.locale && typeof ctx.locale.register === 'function') {
          ctx.effect(function () {
            return ctx.locale.register(DICT, { zh: zh, en: en })
          }, 'dsh-deepseek-web: dictionaries')
          var bound = ctx.locale.bind(DICT)
          if (typeof bound === 'function') return bound
        }
      } catch (error) {
        console.error('dsh-deepseek-web: binding dictionaries failed', error)
      }
      var chinese = typeof navigator !== 'undefined' && /^zh\b/i.test(String(navigator.language || ''))
      var table = chinese ? zh : en
      return function (key) {
        return typeof table[key] === 'string' ? table[key] : key
      }
    }

    // ----------------------------------------------------------------- theme

    var C = {
      label: 'var(--dsw-alias-label-primary, inherit)',
      secondary: 'var(--dsw-alias-label-secondary, inherit)',
      tertiary: 'var(--dsw-alias-label-tertiary, inherit)',
      border: 'var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.25))',
      warn: 'var(--dsw-alias-state-warn-label, #b45309)',
      link: 'var(--dsw-alias-link, inherit)',
      radius: 'var(--dsw-radius-xs, 4px)',
    }

    var WRAP = {
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      gap: '4px',
      color: C.label,
      fontFamily: 'inherit',
      fontSize: '12px',
      lineHeight: '18px',
    }
    var ROW = { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }
    var BTN = {
      boxSizing: 'border-box',
      padding: '3px 10px',
      border: '1px solid ' + C.border,
      borderRadius: C.radius,
      background: 'transparent',
      color: C.label,
      fontFamily: 'inherit',
      fontSize: '12px',
      lineHeight: '18px',
      cursor: 'pointer',
    }
    var BTN_PRIMARY = Object.assign({}, BTN, { borderColor: C.link, color: C.link })
    var BTN_QUIET = Object.assign({}, BTN, {
      borderColor: 'transparent', color: C.tertiary, padding: '3px 6px',
    })
    var HINT = { margin: 0, color: C.tertiary, fontSize: '12px', lineHeight: '18px' }
    var ERROR_BOX = {
      display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
      maxWidth: '560px', color: C.warn, fontSize: '12px', lineHeight: '18px',
    }
    var HINT_BOX = {
      boxSizing: 'border-box', maxWidth: '560px', padding: '8px 10px',
      border: '1px solid ' + C.border, borderRadius: C.radius,
      color: C.secondary, fontSize: '12px', lineHeight: '18px',
    }
    var HINT_LINE = { margin: '2px 0' }

    // -------------------------------------------------------------- settings

    function unbox(value) {
      return value !== null && typeof value === 'object' && typeof value.get === 'function'
        ? value.get()
        : value
    }

    var settings = {
      url: DEFAULT_URL,
      reuseExistingTab: true,
      registerShortcut: true,
    }

    /** Merge a Host configForms snapshot into the live settings. */
    function applySettings(value) {
      if (!value || typeof value !== 'object') return
      var url = unbox(value.url)
      if (typeof url === 'string' && url.trim() !== '') settings.url = url.trim()
      var reuse = unbox(value.reuseExistingTab)
      if (typeof reuse === 'boolean') settings.reuseExistingTab = reuse
      var shortcut = unbox(value.registerShortcut)
      if (typeof shortcut === 'boolean') settings.registerShortcut = shortcut
    }

    // ----------------------------------------------------------------- state

    var state = { phase: 'idle', code: null, detail: null, showDiagnostics: false }
    var listeners = new Set()

    function getState() { return state }

    function setState(patch) {
      state = Object.assign({}, state, patch)
      listeners.forEach(function (fn) {
        try { fn(state) } catch (error) {
          console.error('dsh-deepseek-web: state listener failed', error)
        }
      })
      // A shortcut can fire while the dock component is unmounted. Keep a trace
      // so the failure is never silent.
      if (state.phase === 'error') console.warn('dsh-deepseek-web:', state.code, state.detail || '')
    }

    function subscribe(fn) {
      listeners.add(fn)
      return function () { listeners.delete(fn) }
    }

    // ------------------------------------------------------------------- url

    /** Mirror the built-in Browser address policy before handing a URL over. */
    function validateUrl(raw) {
      if (typeof raw !== 'string' || raw.trim() === '') {
        return { ok: false, detail: 'empty address' }
      }
      var text = raw.trim()
      if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(text)) text = 'https://' + text
      if (text.length > 16384) return { ok: false, detail: 'address too long' }
      var parsed
      try { parsed = new URL(text) } catch (error) {
        return { ok: false, detail: 'malformed address' }
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, detail: 'unsupported scheme ' + parsed.protocol }
      }
      if (parsed.username !== '' || parsed.password !== '') {
        return { ok: false, detail: 'embedded credentials are rejected' }
      }
      return { ok: true, url: parsed.toString() }
    }

    // ---------------------------------------------------------------- timers

    var timers = new Set()

    function later(fn, ms) {
      var id = setTimeout(function () {
        timers.delete(id)
        fn()
      }, ms)
      timers.add(id)
      return id
    }

    function clearTimers() {
      timers.forEach(function (id) { clearTimeout(id) })
      timers.clear()
    }

    // ------------------------------------------------------------- controller

    function createController(ctx) {
      function browserTabs() {
        try {
          var inventory = ctx.sidebarRight && ctx.sidebarRight.openTabs
          var list = inventory && typeof inventory.getSnapshot === 'function'
            ? inventory.getSnapshot()
            : []
          return (Array.isArray(list) ? list : []).filter(function (tab) {
            return tab && tab.kind === BROWSER_KIND
          })
        } catch (error) {
          return []
        }
      }

      function messageOf(error) {
        if (error && typeof error.message === 'string') return error.message
        return String(error || 'unknown error')
      }

      function classify(error) {
        var text = messageOf(error)
        if (/browser|kind|unregistered|not registered|unknown type/i.test(text)) return 'no-browser'
        if (/session|mounted|store|surface|pane/i.test(text)) return 'no-session'
        return 'open-failed'
      }

      function inventoryAvailable() {
        try {
          var inventory = ctx.sidebarRight && ctx.sidebarRight.openTabs
          return !!(inventory && typeof inventory.getSnapshot === 'function')
        } catch (error) {
          return false
        }
      }

      function scheduleVerification(before, known) {
        // Without a live inventory the outcome cannot be judged. Report success
        // rather than a false failure for a tab that may have opened already.
        if (!known) {
          setState({ phase: 'active', code: null, detail: null })
          return
        }
        later(function () {
          if (state.phase !== 'opening') return
          var after = browserTabs()
          var appeared = after.length > before.length || after.some(function (tab) {
            return before.indexOf(tab.tabId) === -1
          })
          setState(appeared
            ? { phase: 'active', code: null, detail: null }
            : { phase: 'error', code: 'not-appeared', detail: null })
        }, VERIFY_DELAY_MS)
      }

      /**
       * Open the web app. `forceNew` bypasses tab reuse (used by "New tab" and
       * Retry, which must produce a fresh navigation rather than reveal a stale
       * page). Reusing an existing Browser tab is what keeps a conversation
       * going: Desktop declares `keepMounted`, so its DOM and page state survive
       * tab switches, sidebar collapse and session changes.
       */
      function open(forceNew) {
        if (!ctx.sidebarRight || typeof ctx.sidebarRight.openTab !== 'function') {
          setState({ phase: 'error', code: 'no-service', detail: null })
          return
        }
        var check = validateUrl(settings.url)
        if (!check.ok) {
          setState({ phase: 'error', code: 'bad-url', detail: check.detail })
          return
        }
        setState({ phase: 'opening', code: null, detail: null, showDiagnostics: false })

        var tabs = browserTabs()
        var before = tabs.map(function (tab) { return tab.tabId })
        var known = inventoryAvailable()

        try {
          if (!forceNew && settings.reuseExistingTab && tabs.length > 0) {
            var target = tabs[tabs.length - 1]
            if (typeof ctx.sidebarRight.focus === 'function') {
              ctx.sidebarRight.focus(target.tabId)
              setState({ phase: 'active', code: null, detail: null })
              return
            }
          }
          ctx.sidebarRight.openTab(BROWSER_KIND, { params: { url: check.url } })
        } catch (error) {
          setState({ phase: 'error', code: classify(error), detail: messageOf(error) })
          return
        }
        scheduleVerification(before, known)
      }

      return {
        open: open,
        retry: function () { open(true) },
        report: function () {
          setState({ phase: 'error', code: 'page-problem', detail: null, showDiagnostics: true })
        },
        toggleDiagnostics: function () {
          setState({ showDiagnostics: !state.showDiagnostics })
        },
      }
    }

    // -------------------------------------------------------------- messages

    function errorText(t, s) {
      if (s.code === 'no-service') return t('errNoService')
      if (s.code === 'no-browser') return t('errNoBrowser')
      if (s.code === 'no-session') return t('errNoSession')
      if (s.code === 'bad-url') return t('errBadUrl') + (s.detail ? ' [' + s.detail + ']' : '')
      if (s.code === 'open-failed') return t('errOpenFailed') + (s.detail ? ' [' + s.detail + ']' : '')
      if (s.code === 'not-appeared') return t('errNotAppeared')
      if (s.code === 'page-problem') return t('errPageProblem')
      return t('errGeneric')
    }

    function diagnosticLines(t) {
      return [t('diag1'), t('diag2'), t('diag3'), t('diag4'), t('diag5')]
    }

    // -------------------------------------------------------------- component

    function Launcher(props) {
      var pair = React.useState(getState())
      var s = pair[0]
      var setS = pair[1]

      React.useEffect(function () {
        return subscribe(function (next) { setS(next) })
      }, [])

      var t = props.t
      return h(
        'div',
        { style: WRAP, 'data-plugin': NS },
        h(
          'div',
          { style: ROW },
          h('button', {
            type: 'button', style: BTN_PRIMARY, title: t('buttonHint'),
            onClick: function () { props.open(false) },
          }, t('open')),
          h('button', {
            type: 'button', style: BTN,
            onClick: function () { props.open(true) },
          }, t('newTab')),
          h('button', {
            type: 'button', style: BTN_QUIET,
            onClick: function () { props.report() },
          }, t('help')),
          s.phase === 'opening' ? h('span', { style: HINT }, t('opening')) : null,
        ),
        s.phase === 'error'
          ? h(
              'div',
              { style: ERROR_BOX, role: 'alert' },
              h('span', null, errorText(t, s)),
              h(
                'span',
                { style: ROW },
                h('button', {
                  type: 'button', style: BTN_QUIET,
                  onClick: function () { props.retry() },
                }, t('retry')),
                h('button', {
                  type: 'button', style: BTN_QUIET,
                  onClick: function () { props.toggleDiagnostics() },
                }, t('diagnostics')),
              ),
            )
          : null,
        s.showDiagnostics
          ? h(
              'div',
              { style: HINT_BOX },
              h('div', { style: { fontWeight: 500, marginBottom: '4px' } }, t('diagnosticsTitle')),
              diagnosticLines(t).map(function (line, index) {
                return h('p', { key: index, style: HINT_LINE }, line)
              }),
            )
          : null,
      )
    }

    // ------------------------------------------------------------------ apply

    function apply(ctx) {
      var t = makeReader(ctx)
      if (!ctx.slots || typeof ctx.slots.inject !== 'function') {
        console.error('dsh-deepseek-web: no slots service; the launcher stays unmounted')
        return
      }
      var controller = createController(ctx)

      // Host configuration is optional. Request the service at runtime so a
      // client without a settings projection still mounts the launcher.
      try {
        if (typeof ctx.inject === 'function') {
          ctx.inject(['configForms'], function (inner) {
            var forms = inner.configForms
            if (!forms || typeof forms.get !== 'function') return
            // A scope obtained before the Host lists this namespace stays
            // unavailable for good, so take it from inside the served gate.
            var register = function () {
              var scope
              try { scope = forms.get(NS) } catch (error) { return function () {} }
              var read = function () {
                try {
                  var snapshot = scope && typeof scope.getSnapshot === 'function'
                    ? scope.getSnapshot()
                    : undefined
                  if (snapshot && snapshot.value) applySettings(snapshot.value)
                } catch (error) { /* A missing namespace keeps the defaults. */ }
              }
              read()
              var off
              try {
                off = scope && typeof scope.subscribe === 'function' ? scope.subscribe(read) : undefined
              } catch (error) { off = undefined }
              return function () {
                if (typeof off === 'function') off()
              }
            }
            var release
            try {
              release = typeof forms.whileServed === 'function'
                ? forms.whileServed([NS], register)
                : register()
            } catch (error) {
              console.warn('dsh-deepseek-web: config namespace not served', error)
              return
            }
            inner.effect(function () {
              return function () {
                if (typeof release === 'function') release()
              }
            }, 'dsh-deepseek-web: config subscription')
          })
        }
      } catch (error) {
        console.warn('dsh-deepseek-web: configuration service unavailable', error)
      }

      // A shortcut is a convenience, not a reason to refuse to mount.
      try {
        if (typeof ctx.inject === 'function') {
          ctx.inject(['shortcuts'], function (inner) {
            var service = inner.shortcuts
            if (!service || typeof service.register !== 'function') return
            inner.effect(function () {
              return service.register({
                id: 'dsh-deepseek-web.open',
                label: function () { return t('shortcutLabel') },
                aliases: ['deepseek web', 'open deepseek web'],
                defaults: {
                  'desktop:windows': { code: 'KeyD', modifiers: ['primary', 'alt'] },
                  'desktop:macos': { code: 'KeyD', modifiers: ['primary', 'alt'] },
                  'desktop:linux': { code: 'KeyD', modifiers: ['primary', 'alt'] },
                },
                regions: ['page', 'editable', 'terminal'],
                modals: [],
                resolve: function () {
                  // Volatile cell updates do not remount this registration; read
                  // the live value instead of capturing it at registration time.
                  if (settings.registerShortcut === false) {
                    return { status: 'blocked', reason: t('shortcutDisabled') }
                  }
                  return { status: 'handled', run: function () { controller.open(false) } }
                },
              })
            }, 'dsh-deepseek-web: shortcut')
          })
        }
      } catch (error) {
        console.warn('dsh-deepseek-web: shortcut registration failed', error)
      }

      try {
        ctx.slots.inject('conversation.composer.dock', function () {
          return ctx.slots.register({
            name: 'conversation.composer.dock',
            id: NS,
            order: 60,
            locale: DICT,
            inject: function () {
              return {
                t: t,
                open: controller.open,
                retry: controller.retry,
                report: controller.report,
                toggleDiagnostics: controller.toggleDiagnostics,
              }
            },
          }, Launcher)
        })
      } catch (error) {
        console.error('dsh-deepseek-web: registering the launcher failed', error)
      }

      ctx.effect(function () { return clearTimers }, 'dsh-deepseek-web: timers')
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale', 'sidebarRight']
    exports.name = NS
    return module.exports
  },
})
