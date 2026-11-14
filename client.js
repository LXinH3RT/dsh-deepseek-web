// dsh-deepseek-web — browser half.
//
// A hand-written client bundle: no build step, no JSX, no ESM import/export in
// this file. The page loads it as a script and `window.__ModuleLoader__` supplies
// `require`; React comes from the browser module table.
//
// This plugin renders no page of its own. It owns one action at the sidebar foot
// (`sidebar.footer.action`) whose button opens the shipped right-Sidebar Browser
// tab (`@deepseek-ai/dsh-client-ui-sidebar-browser`) at a configured HTTPS
// address. The button *is* the action: one click opens (or reveals) the page, with
// no intermediate menu. A panel appears only when there is something to say — the
// first-run environment note, or a failure with its checklist.
//
// Verified against the implementation shipped in DSH 0.2.2-rc.3:
//   - `ctx.slots.inject('sidebar.footer.action', ...)` renders inside the
//     sidebar's `footArea`, above Settings, in both the wide and the rail width.
//     The owner supplies `{ wide }` as its only runtime prop.
//   - The sidebar clips overflow, so the popup is `position: fixed` and anchored
//     to the measured trigger rectangle (the same technique the shipped Cordis
//     panel uses).
//   - `ctx.sidebarRight.openTab('browser', { params: { url } })` opens a Browser
//     tab. Its planner expands the sidebar (`planSetExpanded(state, true)`), so a
//     collapsed sidebar is not a failure mode for this path.
//   - `ctx.sidebarRight.mounted.getSnapshot()` is the on-screen session id;
//     `tabsIn(sessionId)` (a service method, absent from the interface type but
//     present at runtime) lists that session's tabs only. `openTabs` is the
//     cross-session inventory restored from storage, so it is never used to judge
//     what the current session shows.
//   - `ctx.sidebarRight.focus(tabId)` silently returns when the tab is not in the
//     mounted layout and never expands a collapsed sidebar, so the reuse path
//     expands first and focuses afterwards.
//   - The guest page is a `<webview data-sidebar-browser-frame="webview">` in this
//     same renderer; its element-level `executeJavaScript` is available to the
//     embedder (the host's attach policy constrains the guest, not the embedder).
//     That is the only supported way to type into the page, so credential
//     autofill uses it and degrades to a no-op elsewhere.
//   - `ctx.shortcuts.register` and `ctx.configForms.get` are optional services
//     requested at runtime with `ctx.inject`.

window.__ModuleLoader__.load({
  id: 'dsh-deepseek-web',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var React = require('react')
    var h = React.createElement

    // The drop report is painted outside the conversation column, which needs a
    // portal. `react-dom` is part of the client runtime; when it is missing the
    // report simply falls back to rendering in place.
    var ReactDOM = null
    try {
      ReactDOM = require('react-dom')
    } catch (error) {
      ReactDOM = null
    }

    var NS = 'dsh-deepseek-web'
    var DICT = 'dshDeepseekWeb'
    var BROWSER_KIND = 'browser'
    var FOOTER_SLOT = 'sidebar.footer.action'
    // A session-scoped seat used only as a mount point: the entry renders
    // nothing and listens for a dropped conversation link while the session is
    // on screen, which is where the input to quote into comes from.
    var DROP_SLOT = 'conversation.composer.dock'
    var DEFAULT_URL = 'https://chat.deepseek.com'
    var NOTICE_KEY = 'dsh-deepseek-web.environment-notice-dismissed'
    var WEBVIEW_SELECTOR = 'webview[data-sidebar-browser-frame="webview"]'
    var FILL_ATTEMPTS = 12
    var FILL_INTERVAL_MS = 800

    // The configuration page occupies the two seats a bundle's own settings can
    // take in the Plugins tab: the package page, keyed by the package name, and
    // the page of the row `cordis.patch.yml` inserts, keyed `package#row`.
    var BUNDLE_KEY = NS
    var ROW_KEY = BUNDLE_KEY + '#' + BUNDLE_KEY

    // A DeepSeek conversation is addressed as /a/<agent>/s/<session id>, and the
    // page's own session list links to exactly that. A cross-frame drag can carry
    // nothing but standard types, so the drop receives the address only and the
    // transcript is fetched where the session cookie already lives.
    var SESSION_ADDRESS = /\/a\/([A-Za-z0-9_-]+)\/s\/([A-Za-z0-9_-]+)/
    var QUOTE_MAX_CHARS = 12000
    var NOTE_TIMEOUT_MS = 6000

    // ------------------------------------------------------------------ copy

    var zh = {
      trigger: 'DeepSeek 网页版',
      panelTitle: 'DeepSeek 网页版',
      close: '关闭',
      opening: '正在打开…',
      retry: '重试',
      diagnostics: '检查项',
      diagnosticsTitle: '加载失败或状态异常时，按顺序检查',
      buttonHint: '在内置浏览器打开 DeepSeek 网页版',
      shortcutLabel: '打开 DeepSeek 网页版',
      shortcutDisabled: '该快捷键已在插件配置中关闭。',
      noticeTitle: '环境提示',
      noticeBody: 'DeepSeek 网页版运行在内嵌浏览器中，站点可能提示「环境异常」并建议使用官方客户端。插件只在本机打开该页面，不读取、转发或代理对话内容。若在插件配置中填写了账号与密码，插件会在本机自动填入登录页；凭据以明文保存在插件配置文件中。遇到环境提示时，可在 Browser 工具栏选择「在系统浏览器打开」，或直接使用官方客户端。',
      noticeDismiss: '不再提示',
      errNoService: '右侧栏服务未就绪，无法打开标签页。',
      errNoBrowser: '内置 Browser 标签页未启用；请在「插件」中启用 dsh-client-ui-sidebar-browser，Web 配置还需在 profile patch 中设置 disabled: false。',
      errNoSession: '当前没有前台会话，右侧栏无法放置标签页；进入一个会话后重试。',
      errBadUrl: '网页地址无效，仅支持不含账号密码的 http/https 地址。',
      errOpenFailed: '打开标签页失败；请确认右侧栏可用后重试。',
      errNoTranscript: '未能读取该会话内容；请确认侧栏网页版已登录，且该会话仍然存在。',
      errNoInput: '当前会话没有可插入引用的输入框，请先进入一个会话。',
      errNoAddress: '拖入的内容里没有可识别的会话地址。',
      quoteDetail: '来自侧栏 DeepSeek 网页版',
      dropHint: '松开即可把这个会话引用到当前输入框',
      dropNewHint: '松开即可用这个会话新建对话',
      quoted: '已把该会话作为引用插入输入框。',
      emptyConversation: '该会话还没有可引用的内容。',
      newSessionStarted: '已新建会话，并把该会话内容放进输入框。',
      errNoWorkspace: '无法新建会话：工作区服务未就绪，或还没有任何工作区。',
      errGeneric: '发生未预期的错误，请重试。',
      diag1: '再点一次侧栏底部图标；打开的标签页会被复用，不会堆叠。',
      diag2: '若要求重新登录：网页版登录态保存在进程内会话分区，DSH 重启后失效，需要重新登录——填写插件配置的账号密码可自动完成这一步。',
      diag3: '若站点拒绝嵌入、需要下载或弹窗：点 Browser 工具栏的「在系统浏览器打开」。',
      diag4: '确认网络与系统代理可达；内置 Browser 是真实浏览器导航，不走应用内的 web 工具。',
      diag5: '对话、输入与回复由网页版自身承载；插件不读取、注入或转发网页内容（自动填入凭据除外）。',
      settingsTitle: 'DeepSeek 网页版设置',
      settingsSummary: '侧栏底部图标打开的内置浏览器页面、标签页复用、快捷键与登录表单自动填入。',
      urlLabel: '网页地址',
      urlHint: '默认 https://chat.deepseek.com；只接受 http/https 地址。',
      reuseLabel: '复用已打开的标签页',
      reuseHint: '开启时，当前会话已有 DeepSeek 标签页就直接聚焦它；关闭时每次都新开一个。',
      shortcutSwitchLabel: '启用快捷键',
      shortcutSwitchHint: '关闭后，快捷键不再打开页面，侧栏图标的点击不受影响。',
      autoFillLabel: '自动填入登录信息',
      autoFillHint: '打开页面后，若登录表单里有密码框，就用下面的账号与密码填好并尝试点击登录按钮。',
      accountLabel: '账号',
      accountHint: '手机号或邮箱；留空则不自动填入。',
      passwordLabel: '密码',
      passwordHint: '明文保存在本机插件配置文件中，仅用于本地自动填入；留空则不自动填入。',
      passwordStored: '已保存密码；留空表示保持不变。',
      passwordMissing: '尚未保存密码。',
      passwordClear: '清除已保存的密码',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      discard: '放弃修改',
      readOnly: '本部署的设置为只读。',
      unavailable: '该插件当前未加载，暂时无法配置。',
      rejected: '本部署没有接受这次改动，内容已保留供你检查。',
      conflict: '配置已被其他改动更新，请重新载入后再试。',
      effective: '当前生效',
      overridden: '已覆盖',
      empty: '未指定',
    }

    var en = {
      trigger: 'DeepSeek Web',
      panelTitle: 'DeepSeek Web',
      close: 'Close',
      opening: 'Opening…',
      retry: 'Retry',
      diagnostics: 'Checks',
      diagnosticsTitle: 'When loading fails or the tab looks wrong, check in order',
      buttonHint: 'Open the DeepSeek web app in the built-in browser',
      shortcutLabel: 'Open DeepSeek Web',
      shortcutDisabled: 'This shortcut is disabled in the plugin settings.',
      noticeTitle: 'Environment note',
      noticeBody: 'The DeepSeek web app runs inside an embedded browser, and the site may report an unsupported environment and suggest its official client. This plugin only opens the page locally; it never reads, relays or proxies a conversation. If an account and password are set in the plugin configuration, the plugin types them into the local sign-in form; that password is stored in plain text in the plugin configuration file. If the environment notice appears, use "Open in system browser" in the Browser toolbar, or use the official client directly.',
      noticeDismiss: "Don't show again",
      errNoService: 'The right sidebar service is unavailable, so no tab can be opened.',
      errNoBrowser: 'The built-in Browser tab is disabled. Enable dsh-client-ui-sidebar-browser in Plugins; Web profiles also need disabled: false in the profile patch.',
      errNoSession: 'No session is on screen, so the sidebar cannot place a tab. Enter a session and retry.',
      errBadUrl: 'Invalid address. Only http/https URLs without embedded credentials are accepted.',
      errOpenFailed: 'Opening the tab failed; check that the right sidebar is available and retry.',
      errNoTranscript: 'The conversation could not be read. Make sure the embedded web app is signed in and the conversation still exists.',
      errNoInput: 'This session has no input to quote into; open a session first.',
      errNoAddress: 'The dropped content carries no recognisable conversation address.',
      quoteDetail: 'From the DeepSeek web app in the sidebar',
      dropHint: 'Release to quote this conversation into the current input',
      dropNewHint: 'Release to start a new session from this conversation',
      quoted: 'The conversation was quoted into the input.',
      emptyConversation: 'That conversation has nothing to quote yet.',
      newSessionStarted: 'A new session was started with the conversation in its input.',
      errNoWorkspace: 'No session can be started: the workspace service is unavailable, or no workspace exists yet.',
      errGeneric: 'Unexpected error; please retry.',
      diag1: 'Click the sidebar foot icon again; the open tab is reused instead of stacking new ones.',
      diag2: 'If asked to sign in again: web login state lives in a process-local partition and is lost when DSH restarts. Filling in the configured credentials automates that step.',
      diag3: 'If the site refuses embedding or needs downloads/popups, use "Open in system browser" in the Browser toolbar.',
      diag4: 'Check network and system proxy reachability. The built-in Browser performs real navigation, not an in-app web fetch.',
      diag5: 'Conversations, input and replies belong to the web app; this plugin never reads, injects or relays page content (except typing the configured credentials).',
      settingsTitle: 'DeepSeek Web settings',
      settingsSummary: 'The sidebar-foot button, tab reuse, the shortcut, and automatic sign-in for the embedded page.',
      urlLabel: 'Web address',
      urlHint: 'Defaults to https://chat.deepseek.com; only http/https addresses are accepted.',
      reuseLabel: 'Reuse an open tab',
      reuseHint: 'On: a DeepSeek tab already open in this session is focused. Off: every click opens a new tab.',
      shortcutSwitchLabel: 'Enable the shortcut',
      shortcutSwitchHint: 'When off the shortcut stops opening the page; the sidebar button still works.',
      autoFillLabel: 'Fill in the sign-in form',
      autoFillHint: 'After the page opens, a visible password field is filled with the account and password below, and the sign-in button is clicked once.',
      accountLabel: 'Account',
      accountHint: 'Phone number or email. Leave blank to skip filling.',
      passwordLabel: 'Password',
      passwordHint: 'Stored in plain text in this machine’s plugin configuration, used only for local filling. Leave blank to skip filling.',
      passwordStored: 'A password is stored; leave blank to keep it.',
      passwordMissing: 'No password is stored yet.',
      passwordClear: 'Clear the stored password',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      discard: 'Discard',
      readOnly: 'This deployment stores settings read-only.',
      unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
      rejected: 'The deployment did not accept this change; it was left for you to correct.',
      conflict: 'The configuration changed elsewhere; reload and try again.',
      effective: 'Effective value',
      overridden: 'Overridden',
      empty: 'not set',
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
      tertiary: 'var(--dsw-alias-label-secondary, inherit)',
      border: 'var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.25))',
      borderSubtle: 'var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.25))',
      warn: 'var(--dsw-alias-state-warn-primary, #b45309)',
      link: 'var(--dsw-alias-brand-primary, inherit)',
      hover: 'var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.12))',
      surface: 'var(--dsw-alias-bg-overlay, Canvas)',
      radius: '4px',
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
    var BTN_QUIET = Object.assign({}, BTN, {
      borderColor: 'transparent', color: C.tertiary, padding: '3px 6px',
    })
    var HINT = { margin: 0, color: C.tertiary, fontSize: '12px', lineHeight: '18px' }
    var ERROR_BOX = {
      display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
      color: C.warn, fontSize: '12px', lineHeight: '18px',
    }
    var SECTION = {
      boxSizing: 'border-box', padding: '8px 10px',
      border: '1px solid ' + C.border, borderRadius: '8px',
      color: C.secondary, fontSize: '12px', lineHeight: '18px',
    }
    var HINT_LINE = { margin: '2px 0' }
    // The drop report is an overlay, not a row: the composer dock sits in the
    // conversation column, so anything that occupies space there pushes the
    // composer around. It stays out of flow and only paints over the bottom.
    var DROP_HINT = {
      position: 'fixed', zIndex: 40, left: '50%', bottom: '96px',
      transform: 'translateX(-50%)', boxSizing: 'border-box',
      maxWidth: 'calc(100vw - 32px)', padding: '8px 12px',
      border: '1px solid ' + C.border, borderRadius: '8px',
      background: C.surface, boxShadow: '0 6px 18px rgba(0, 0, 0, 0.22)',
      color: C.label, fontFamily: 'inherit', fontSize: '12px', lineHeight: '18px',
      pointerEvents: 'none', margin: 0,
    }

    // -------------------------------------------------------------- sidebar fit
    // The footer action slot supplies `{ wide }`: a call-to-action row at full
    // width, a 36px round button inside the rail.

    var STYLE_ID = 'dsh-deepseek-web-style'
    var CSS_TEXT = [
      '[data-dsh-deepseek-web-trigger]{transition:background-color .12s ease}',
      '@media (hover:hover){[data-dsh-deepseek-web-trigger]:hover{background:' + 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.12))' + '}}',
      '[data-dsh-deepseek-web-trigger][data-busy]{background:' + 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.12))' + '}',
      '[data-dsh-deepseek-web-trigger]:focus-visible{outline:2px solid var(--dsw-alias-brand-primary, currentColor);outline-offset:2px}',
      '[data-dsh-deepseek-web-panel] button:hover{background:' + 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.12))' + '}',
      '[data-dsh-deepseek-web-panel] button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary, currentColor);outline-offset:2px}',
    ].join('')

    /** Install the hover/focus rules once; the caller disposes them. */
    function installStyle() {
      if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
        return function () {}
      }
      var existing = document.getElementById(STYLE_ID)
      if (existing !== null) return function () {}
      var node = document.createElement('style')
      node.id = STYLE_ID
      node.textContent = CSS_TEXT
      document.head.appendChild(node)
      return function () {
        if (node.parentNode !== null) node.parentNode.removeChild(node)
      }
    }

    var LAYER_WIDE = {
      position: 'relative', flex: 'none', display: 'flex', alignItems: 'center',
      boxSizing: 'border-box', width: '100%', height: '42px', margin: '8px 0 0',
    }
    var LAYER_RAIL = {
      position: 'relative', flex: 'none', display: 'flex', alignItems: 'center',
      justifyContent: 'center', width: '36px', height: '36px',
    }
    var BADGE = {
      display: 'inline-flex', alignItems: 'center', gap: '8px',
      boxSizing: 'border-box', width: '100%', height: '42px', margin: '0 -2px',
      padding: '0 10px 0 8px', border: 'none', borderRadius: '12px',
      background: 'transparent', color: C.label,
      fontFamily: 'inherit', fontSize: '14px', lineHeight: '20px',
      textAlign: 'left', cursor: 'pointer', overflow: 'hidden',
    }
    var BADGE_RAIL = {
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      boxSizing: 'border-box', width: '36px', height: '36px', padding: 0,
      border: 'none', borderRadius: '50%', background: 'transparent',
      color: C.label, cursor: 'pointer',
    }
    var BADGE_LABEL = {
      minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }
    var PANEL = {
      position: 'fixed', zIndex: 30, display: 'flex', flexDirection: 'column',
      boxSizing: 'border-box', width: '360px', maxWidth: 'calc(100vw - 24px)',
      maxHeight: '60vh', overflowY: 'auto', padding: '12px', gap: '8px',
      border: '1px solid ' + C.borderSubtle,
      borderRadius: '12px',
      background: C.surface,
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.24)',
      color: C.label, fontFamily: 'inherit', fontSize: '12px', lineHeight: '18px',
    }
    var PANEL_HEAD = {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
    }
    var PANEL_TITLE = {
      fontSize: '14px', fontWeight: 500, lineHeight: '20px', color: C.label,
    }

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
      autoFill: true,
      account: '',
      password: '',
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
      var fill = unbox(value.autoFill)
      if (typeof fill === 'boolean') settings.autoFill = fill
      var account = unbox(value.account)
      if (typeof account === 'string') settings.account = account.trim()
      var password = unbox(value.password)
      if (typeof password === 'string') settings.password = password
    }

    // ---------------------------------------------------------------- notice
    // The first run explains the embedded-environment caveat once, when the
    // button is first used. The flag lives in localStorage so it survives DSH
    // restarts; without storage the notice stays hidden rather than reappearing
    // on every launch.

    var notice = { pending: false }

    function storageOf() {
      try {
        return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
      } catch (error) {
        return null
      }
    }

    function probeNotice() {
      var store = storageOf()
      if (store === null) return false
      try {
        return store.getItem(NOTICE_KEY) !== '1'
      } catch (error) {
        return false
      }
    }

    function dismissNotice() {
      notice.pending = false
      var store = storageOf()
      if (store !== null) {
        try { store.setItem(NOTICE_KEY, '1') } catch (error) { /* Private mode keeps it per run. */ }
      }
      setState({})
    }

    // ----------------------------------------------------------------- state

    var state = { phase: 'idle', code: null, detail: null, showDiagnostics: false }
    var listeners = new Set()

    function getState() { return state }

    function emit() {
      listeners.forEach(function (fn) {
        try { fn(state) } catch (error) {
          console.error('dsh-deepseek-web: state listener failed', error)
        }
      })
    }

    function setState(patch) {
      state = Object.assign({}, state, patch)
      emit()
      // A shortcut can fire while the panel is unmounted. Keep a trace so the
      // failure is never silent.
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

    // -------------------------------------------------------------- autofill
    // The guest page is a <webview> in this renderer, so the embedder side can
    // run a script inside it. The script only looks at the visible sign-in form:
    // no password field means the page is already signed in (or not loaded yet),
    // and it then changes nothing.

    function hostOf(raw) {
      try { return new URL(raw).hostname } catch (error) { return '' }
    }

    function guestPages(host) {
      if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return []
      var nodes
      try { nodes = document.querySelectorAll(WEBVIEW_SELECTOR) } catch (error) { return [] }
      var pages = []
      for (var i = 0; i < nodes.length; i += 1) {
        var node = nodes[i]
        var current = ''
        try { current = typeof node.getURL === 'function' ? String(node.getURL() || '') : '' } catch (error) { current = '' }
        if (current === '' || hostOf(current) !== host) continue
        pages.push(node)
      }
      return pages
    }

    /** In-page script: fill the visible sign-in form and submit it once. */
    function fillScript(account, secret) {
      var payload = JSON.stringify({ account: account, secret: secret })
      return '(function(){var data=' + payload + ';try{' +
        'var visible=function(el){var r=el.getBoundingClientRect();return r.width>0&&r.height>0};' +
        'var all=Array.prototype.slice.call(document.querySelectorAll("input"));' +
        'var inputs=all.filter(function(el){return el.type!=="hidden"&&!el.disabled&&!el.readOnly&&visible(el)});' +
        'var password=null,i;for(i=0;i<inputs.length;i++){if(inputs[i].type==="password"){password=inputs[i];break}}' +
        'if(!password)return "no-password-field";' +
        'var accountField=null;for(i=0;i<inputs.length;i++){var el=inputs[i];if(el===password)continue;var type=(el.type||"").toLowerCase();if(type==="text"||type==="tel"||type==="email"||type===""){accountField=el;break}}' +
        'var setValue=function(el,value){var view=el.ownerDocument.defaultView||window;var proto=view.HTMLInputElement.prototype;var desc=Object.getOwnPropertyDescriptor(proto,"value");if(desc&&typeof desc.set==="function"){desc.set.call(el,value)}else{el.value=value}el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}))};' +
        'if(accountField&&data.account)setValue(accountField,data.account);' +
        'setValue(password,data.secret);' +
        'var buttons=Array.prototype.slice.call(document.querySelectorAll("button,[role=button]"));' +
        'for(i=0;i<buttons.length;i++){var b=buttons[i];var label=String(b.innerText||b.textContent||"").trim();if(!label||!visible(b))continue;if(/^(登录|登 录|log ?in|sign ?in)$/i.test(label)){setTimeout(function(){b.click()},400);return "submitted"}}' +
        'return "filled"' +
        '}catch(error){return "error:"+((error&&error.message)||"unknown")}})()'
    }

    /**
     * Type the configured credentials into the page once it is loaded.
     * Stops on the first filled form; every step is bounded and cancellable.
     */
    function scheduleFill(host) {
      if (!settings.autoFill || settings.password === '') return
      var remaining = FILL_ATTEMPTS
      function attempt() {
        if (remaining <= 0) return
        remaining -= 1
        var pages = guestPages(host)
        if (pages.length === 0) {
          later(attempt, FILL_INTERVAL_MS)
          return
        }
        var page = pages[pages.length - 1]
        if (typeof page.executeJavaScript !== 'function') return
        var outcome = null
        try {
          outcome = page.executeJavaScript(fillScript(settings.account, settings.password), true)
        } catch (error) {
          return
        }
        if (!outcome || typeof outcome.then !== 'function') return
        outcome.then(function (result) {
          var text = String(result || '')
          if (text === 'filled' || text === 'submitted') return
          if (text.indexOf('error:') === 0) return
          later(attempt, FILL_INTERVAL_MS)
        }, function () {
          later(attempt, FILL_INTERVAL_MS)
        })
      }
      later(attempt, FILL_INTERVAL_MS)
    }

    // ------------------------------------------------------------- transcript
    // The dropped link names a conversation; its text lives behind the session
    // cookie, so the read happens inside the guest page that already holds it.
    // Nothing leaves this machine: the script only calls the site's own API with
    // the visitor's own credentials.

    function transcriptScript(sessionId) {
      var id = JSON.stringify(String(sessionId))
      return '(function(){' +
        'var id=' + id + ';' +
        // The site keeps its token in localStorage as `{value, __version}`, not
        // as a bare string, so the wrapped value has to be unwrapped first.
        'var token="";' +
        'try{' +
        'var raw=window.localStorage.getItem("userToken");' +
        'if(raw){var parsed=JSON.parse(raw);' +
        'token=parsed&&typeof parsed==="object"&&"value"in parsed?String(parsed.value||""):String(raw)}' +
        '}catch(error){}' +
        // The site also stamps every request with its client identity; without
        // these the API answers 4xx before it ever looks at the credentials.
        'var base={"x-client-bundle-id":"com.deepseek.chat","x-client-platform":"web",' +
        '"x-client-version":"2.8.0","x-client-locale":(navigator.language||"en")};' +
        'try{base["x-client-timezone-offset"]=String(-new Date().getTimezoneOffset())}catch(error){}' +
        // Cache hints are optional: the site sends them only when it already has
        // a cached copy, and sending a literal "null" makes the request invalid.
        'var url="/api/v0/chat/history_messages?chat_session_id="+encodeURIComponent(id);' +
        'function ask(withToken){' +
        'var headers={};for(var key in base)headers[key]=base[key];' +
        'if(withToken&&token)headers.Authorization="Bearer "+token;' +
        'return fetch(url,{credentials:"include",headers:headers})' +
        '}' +
        // A rejected bearer token is worse than none: the cookie already proves
        // the session, so a 4xx is retried once without the header.
        'function attempt(response){' +
        'if((response.status===401||response.status===403)&&token)return ask(false);' +
        'return response}' +
        'return ask(true).then(attempt).then(function(response){' +
        'if(!response.ok)return {ok:false,reason:"http "+response.status+(token?"":" (no token)")};' +
        'return response.text().then(function(body){' +
        'var json=null;try{json=JSON.parse(body)}catch(error){' +
        'return {ok:false,reason:"not json: "+body.slice(0,120)}}' +
        'var data=json&&json.data;var code=data&&data.biz_code;' +
        'if(code&&code!==0)return {ok:false,reason:"biz_code "+code};' +
        'var payload=data&&data.biz_data;if(!payload)return {ok:false,reason:"no data"};' +
        'var title=String((payload.chat_session&&payload.chat_session.title)||"");' +
        'var messages=Array.isArray(payload.chat_messages)?payload.chat_messages:[];' +
        'var lines=[];' +
        'for(var i=0;i<messages.length;i+=1){' +
        'var message=messages[i];var fragments=Array.isArray(message.fragments)?message.fragments:[];' +
        'for(var j=0;j<fragments.length;j+=1){' +
        'var fragment=fragments[j];var kind=String(fragment&&fragment.type||"");' +
        'var who=kind==="REQUEST"?"用户":(kind==="RESPONSE"||kind==="TEMPLATE_RESPONSE"?"助手":"");' +
        'if(!who)continue;var content=String(fragment.content||"").trim();if(!content)continue;' +
        'lines.push("**"+who+"**："+content)}}' +
        'return {ok:true,title:title,text:lines.join("\\n\\n"),count:messages.length}' +
        '})' +
        '}).catch(function(error){return {ok:false,reason:String((error&&error.message)||error)}})' +
        '})()'
    }

    /** The conversation id carried by a dropped link, if the drop carries one. */
    function droppedSessionId(transfer) {
      if (!transfer || typeof transfer.getData !== 'function') return ''
      var types = []
      try {
        types = Array.prototype.slice.call(transfer.types || [])
      } catch (error) { types = [] }
      var order = ['text/uri-list', 'text/plain', 'text/html']
      var seen = []
      for (var index = 0; index < order.length; index += 1) {
        if (types.indexOf(order[index]) === -1) continue
        var raw = ''
        try { raw = String(transfer.getData(order[index]) || '') } catch (error) { raw = '' }
        if (raw === '') continue
        seen.push(raw)
      }
      // A drop with no standard type listed still exposes text/plain on some
      // platforms; read it once more rather than guessing from the type list.
      if (seen.length === 0) {
        try {
          var fallback = String(transfer.getData('text/plain') || '')
          if (fallback !== '') seen.push(fallback)
        } catch (error) { /* Nothing was carried. */ }
      }
      for (var at = 0; at < seen.length; at += 1) {
        var match = SESSION_ADDRESS.exec(seen[at])
        if (match !== null) return match[2]
      }
      return ''
    }

    /** The guest page showing the embedded web app, whichever host it is on. */
    function webAppGuest() {
      if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return null
      var nodes
      try { nodes = document.querySelectorAll(WEBVIEW_SELECTOR) } catch (error) { return null }
      if (nodes.length === 0) return null
      var wanted = hostOf(settings.url)
      var loaded = null
      var blank = null
      for (var index = 0; index < nodes.length; index += 1) {
        var node = nodes[index]
        var current = ''
        try { current = typeof node.getURL === 'function' ? String(node.getURL() || '') : '' } catch (error) { current = '' }
        // Before the guest commits a navigation it reports about:blank, so those
        // nodes are only a fallback: a guest that already shows the site wins.
        if (current === '') {
          if (blank === null) blank = node
          continue
        }
        if (wanted !== '' && hostOf(current) === wanted) return node
        if (loaded === null) loaded = node
      }
      return loaded !== null ? loaded : blank
    }

    /** The message of a thrown value, for reporting a concrete failure reason. */
    function messageOf(error) {
      if (error && typeof error.message === 'string' && error.message !== '') return error.message
      return String(error || 'unknown error')
    }

    /** The type list a drop carried, for reporting what actually arrived. */
    function describedTypes(transfer) {
      if (!transfer) return 'no data transfer'
      var types = []
      try { types = Array.prototype.slice.call(transfer.types || []) } catch (error) { types = [] }
      return types.length === 0 ? 'no types' : types.join(', ')
    }

    /**
     * Whether a drop landed on the composer card. The card is the capsule that
     * holds the input, so a drop there means "quote into this input"; the same
     * drag released anywhere else means "start a new session from it".
     */
    function insideComposer(node) {
      if (!node || typeof node.closest !== 'function') return false
      try { return node.closest('[data-composer-card]') !== null } catch (error) { return false }
    }

    /**
     * Read the dropped conversation from inside the embedded page.
     * Resolves to `{ status: 'read', text, title }` or a failure with the
     * concrete reason, so both the quote and the new-session path can report it.
     */
    function readTranscript(sessionId) {
      var page = webAppGuest()
      if (page === null) {
        return Promise.resolve({ status: 'no-transcript', detail: 'no web view' })
      }
      if (typeof page.executeJavaScript !== 'function') {
        return Promise.resolve({ status: 'no-transcript', detail: 'no executeJavaScript' })
      }
      var outcome
      try {
        outcome = page.executeJavaScript(transcriptScript(sessionId), true)
      } catch (error) {
        return Promise.resolve({ status: 'no-transcript', detail: 'script threw: ' + messageOf(error) })
      }
      if (!outcome || typeof outcome.then !== 'function') {
        return Promise.resolve({ status: 'no-transcript', detail: 'no promise from web view' })
      }
      return outcome.then(function (result) {
        var payload = result
        if (typeof payload === 'string') {
          try { payload = JSON.parse(payload) } catch (error) { payload = null }
        }
        if (!payload) return { status: 'no-transcript', detail: 'unparsable result' }
        if (payload.ok !== true) {
          return { status: 'no-transcript', detail: String(payload.reason || 'unknown') }
        }
        var text = String(payload.text || '').trim()
        if (text === '') return { status: 'empty-conversation', detail: 'no messages' }
        if (text.length > QUOTE_MAX_CHARS) text = text.slice(0, QUOTE_MAX_CHARS) + '\n…'
        return { status: 'read', detail: '', text: text, title: String(payload.title || '').trim() }
      }, function (error) {
        return { status: 'no-transcript', detail: 'read failed: ' + messageOf(error) }
      })
    }

    /**
     * Read the dropped conversation and quote it into the current input.
     * Resolves to `{ status, detail }` so the caller can report what happened:
     * the detail is the concrete reason a read failed, not a generic sentence.
     */
    function quoteDropped(sessionId, inputActions, t) {
      if (!inputActions || typeof inputActions.insertQuote !== 'function') {
        return Promise.resolve({ status: 'no-input', detail: 'no input actions' })
      }
      return readTranscript(sessionId).then(function (outcome) {
        if (outcome.status !== 'read') return outcome
        var summary = { label: t('quoteDetail') }
        if (outcome.title !== '') summary.title = outcome.title
        var accepted = inputActions.insertQuote(outcome.text, summary)
        if (accepted === false) return { status: 'no-input', detail: 'insertQuote refused' }
        return { status: 'quoted', detail: '' }
      })
    }

    /**
     * Read the dropped conversation and open a new session with its text as the
     * initial draft. `startSession` is the official entry point; it returns
     * nothing and reports its own failures, so this only settles the part it can
     * observe: whether the address was read and whether the call was accepted.
     */
    function startSessionFrom(sessionId, workspace, t) {
      return readTranscript(sessionId).then(function (outcome) {
        if (outcome.status !== 'read') return outcome
        if (!workspace || typeof workspace.startSession !== 'function') {
          return { status: 'no-workspace', detail: 'no uiWorkspace service' }
        }
        try {
          workspace.startSession(undefined, { prompt: outcome.text, whenDraftExists: 'append' })
        } catch (error) {
          return { status: 'no-workspace', detail: 'startSession threw: ' + messageOf(error) }
        }
        return { status: 'started', detail: '' }
      })
    }

    // ------------------------------------------------------------ controller

    function createController(ctx) {
      function service() {
        return ctx.sidebarRight || null
      }

      function classify(error) {
        var text = messageOf(error)
        if (/browser|kind|unregistered|not registered|unknown type/i.test(text)) return 'no-browser'
        if (/session|mounted|store|surface|pane/i.test(text)) return 'no-session'
        return 'open-failed'
      }

      function mountedSession() {
        var target = service()
        try {
          var snap = target && target.mounted
          if (snap && typeof snap.getSnapshot === 'function') return snap.getSnapshot()
        } catch (error) { /* No mounted session is a valid state. */ }
        return undefined
      }

      /**
       * Browser tabs of the on-screen session only. The cross-session inventory
       * restored from storage would report tabs this session cannot show, and
       * with no session on screen nothing is showable at all.
       */
      function sessionTabs(sessionId) {
        var target = service()
        if (!target || sessionId === undefined) return []
        try {
          if (typeof target.tabsIn === 'function') {
            var own = target.tabsIn(sessionId)
            if (Array.isArray(own)) {
              return own.filter(function (tab) { return tab && tab.kind === BROWSER_KIND })
            }
          }
        } catch (error) { /* Fall back to the inventory below. */ }
        try {
          var inventory = target.openTabs
          var list = inventory && typeof inventory.getSnapshot === 'function' ? inventory.getSnapshot() : []
          return (Array.isArray(list) ? list : []).filter(function (tab) {
            return tab && tab.kind === BROWSER_KIND && tab.sessionId === sessionId
          })
        } catch (error) {
          return []
        }
      }

      /** `focus` never expands a collapsed sidebar, so expand before focusing. */
      function reveal(tabId) {
        var target = service()
        var expanded = true
        try {
          if (typeof target.isExpanded === 'function') expanded = target.isExpanded() !== false
        } catch (error) { expanded = true }
        if (!expanded && typeof target.toggleExpanded === 'function') {
          try { target.toggleExpanded() } catch (error) { /* The focus below still runs. */ }
        }
        if (typeof target.focus === 'function') target.focus(tabId)
      }

      /**
       * Open the web app. One click, one outcome: reveal the session's existing
       * Browser tab, or place a new one. `openTab` expands the sidebar itself and
       * throws when nothing can be placed, so failures are reported from there.
       */
      function open() {
        var target = service()
        if (!target || typeof target.openTab !== 'function') {
          setState({ phase: 'error', code: 'no-service', detail: null })
          return
        }
        var check = validateUrl(settings.url)
        if (!check.ok) {
          setState({ phase: 'error', code: 'bad-url', detail: check.detail })
          return
        }
        var sessionId = mountedSession()
        var existing = settings.reuseExistingTab === false ? [] : sessionTabs(sessionId)
        setState({ phase: 'opening', code: null, detail: null, showDiagnostics: false })
        try {
          if (existing.length > 0) {
            reveal(existing[existing.length - 1].tabId)
          } else {
            target.openTab(BROWSER_KIND, { params: { url: check.url } })
          }
        } catch (error) {
          setState({ phase: 'error', code: classify(error), detail: messageOf(error) })
          return
        }
        setState({ phase: 'active', code: null, detail: null })
        scheduleFill(hostOf(check.url))
      }

      return {
        open: open,
        retry: open,
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
      return t('errGeneric')
    }

    function diagnosticLines(t) {
      return [t('diag1'), t('diag2'), t('diag3'), t('diag4'), t('diag5')]
    }

    // -------------------------------------------------------------- component

    /** The DeepSeek mark: a speech bubble drawn with the current text colour. */
    function Icon() {
      return h(
        'svg',
        {
          width: '16', height: '16', viewBox: '0 0 16 16', fill: 'none',
          'aria-hidden': 'true', focusable: 'false',
        },
        h('path', {
          d: 'M8 1.4C4.3 1.4 1.4 3.9 1.4 6.9c0 1.7.9 3.2 2.3 4.2V14l2.5-1.3c.6.1 1.2.2 1.8.2 3.7 0 6.6-2.5 6.6-5.5S11.7 1.4 8 1.4Z',
          fill: 'currentColor',
        }),
      )
    }

    // ------------------------------------------------------------ drop target
    // A conversation dragged out of the embedded web app arrives as an ordinary
    // link, so the drop is caught at the document level: the composer's own
    // handler only looks at files, and a dragover that carries no conversation
    // address is left alone.

    function carriesConversation(transfer) {
      if (droppedSessionId(transfer) !== '') return true
      if (!transfer || typeof transfer.getData !== 'function') return false
      // During dragover most engines refuse getData, so the type list is the only
      // signal left. Whether the payload really is a conversation is decided on
      // drop; until then any text-carrying drag is treated as a candidate. A drag
      // of files lists none of these types and is left to the composer.
      var types = []
      try { types = Array.prototype.slice.call(transfer.types || []) } catch (error) { return false }
      return types.indexOf('text/uri-list') !== -1 ||
        types.indexOf('text/plain') !== -1 ||
        types.indexOf('text/html') !== -1
    }

    /**
     * Session-scoped listener that turns a dropped conversation link into a
     * quote in this input, or — when released outside the composer card — into
     * a fresh session whose draft is that conversation. The report is painted as
     * a fixed overlay so it never takes part in the composer's layout.
     */
    function DropTarget(props) {
      var t = props.t
      // Resolved lazily on drop: the workspace service is only needed for the
      // new-session path, and it must not be required for the quote path.
      var getWorkspace = props.getWorkspace
      // Session-scoped seats project `inputActions` as a standard prop, so the
      // quote goes into the input of the session this entry belongs to.
      var inputActions = props.inputActions

      var hintPair = React.useState('')
      var hinted = hintPair[0]
      var setHinted = hintPair[1]

      var notePair = React.useState('')
      var note = notePair[0]
      var setNote = notePair[1]

      React.useEffect(function () {
        if (typeof document === 'undefined') return undefined
        var depth = 0
        var reportTimer = null

        // The report is a one-line answer to a finished drag, not a status that
        // should stay: it clears itself so nothing is left behind.
        function report(text) {
          setNote(text)
          if (reportTimer !== null) clearTimeout(reportTimer)
          reportTimer = setTimeout(function () {
            reportTimer = null
            setNote('')
          }, NOTE_TIMEOUT_MS)
        }

        // The face of the hint follows the pointer: over the capsule the drop
        // quotes into the input, anywhere else it starts a new session.
        function faceOf(node) {
          return t(insideComposer(node) ? 'dropHint' : 'dropNewHint')
        }

        function onDragEnter(event) {
          if (!event.dataTransfer) return
          if (!carriesConversation(event.dataTransfer)) return
          depth += 1
          setHinted(faceOf(event.target))
        }

        function onDragOver(event) {
          if (!event.dataTransfer) return
          if (!carriesConversation(event.dataTransfer)) return
          // Taking the event keeps the browser from navigating to the link.
          event.preventDefault()
          if (event.dataTransfer.dropEffect !== undefined) event.dataTransfer.dropEffect = 'copy'
          // The payload stays unreadable until the drop, so the face follows the
          // pointer target here and the conversation itself is resolved on drop.
          setHinted(faceOf(event.target))
        }

        function onDragLeave() {
          depth -= 1
          if (depth <= 0) {
            depth = 0
            setHinted('')
          }
        }

        function onDrop(event) {
          var sessionId = event.dataTransfer ? droppedSessionId(event.dataTransfer) : ''
          var candidate = hinted !== ''
          var quoted = insideComposer(event.target)
          depth = 0
          setHinted('')
          if (sessionId === '') {
            // A drag that announced itself as a conversation but carries no
            // address is reported: staying silent would look like a dead button.
            if (candidate) {
              event.preventDefault()
              event.stopPropagation()
              report(t('errNoAddress') + ' (' + describedTypes(event.dataTransfer) + ')')
            }
            return
          }
          event.preventDefault()
          event.stopPropagation()
          var outcome = quoted
            ? quoteDropped(sessionId, inputActions, t)
            : startSessionFrom(sessionId, props.getWorkspace(), t)
          outcome.then(function (result) {
            if (result.status === 'quoted') { report(t('quoted')); return }
            if (result.status === 'started') { report(t('newSessionStarted')); return }
            var head = result.status === 'no-input'
              ? t('errNoInput')
              : result.status === 'no-workspace'
                ? t('errNoWorkspace')
                : result.status === 'empty-conversation' ? t('emptyConversation') : t('errNoTranscript')
            // The reason is part of the report: without it the only thing left
            // is a sentence that says nothing about what actually failed.
            report(result.detail ? head + ' (' + result.detail + ')' : head)
          }, function (error) { report(t('errNoTranscript') + ' (' + messageOf(error) + ')') })
        }

        document.addEventListener('dragenter', onDragEnter, true)
        document.addEventListener('dragover', onDragOver, true)
        document.addEventListener('dragleave', onDragLeave, true)
        document.addEventListener('drop', onDrop, true)
        return function () {
          document.removeEventListener('dragenter', onDragEnter, true)
          document.removeEventListener('dragover', onDragOver, true)
          document.removeEventListener('dragleave', onDragLeave, true)
          document.removeEventListener('drop', onDrop, true)
          if (reportTimer !== null) {
            clearTimeout(reportTimer)
            reportTimer = null
          }
        }
      }, [getWorkspace, inputActions, t])

      if (hinted === '' && note === '') return null
      var line = h(
        'p',
        { style: DROP_HINT, 'data-dsh-deepseek-web-drop': 'true', role: 'status' },
        hinted !== '' ? hinted : note,
      )
      // The composer dock is inside the conversation column, so the hint is
      // portalled to the document body to stay out of that layout entirely.
      if (ReactDOM && typeof ReactDOM.createPortal === 'function' &&
        typeof document !== 'undefined' && document.body) {
        return ReactDOM.createPortal(line, document.body)
      }
      return line
    }

    function Panel(props) {
      var wide = props.wide !== false
      var t = props.t

      var snapshot = React.useState(getState())
      var status = snapshot[0]
      var setStatus = snapshot[1]

      var openPair = React.useState(false)
      var isOpen = openPair[0]
      var setOpen = openPair[1]

      var rootRef = React.useRef(null)
      var anchorPair = React.useState(undefined)
      var anchor = anchorPair[0]
      var setAnchor = anchorPair[1]

      React.useEffect(function () {
        return subscribe(function (next) { setStatus(next) })
      }, [])

      // A failure is the one thing the panel must surface on its own.
      React.useEffect(function () {
        if (status.phase === 'error') setOpen(true)
      }, [status.phase])

      // The sidebar clips overflow, so the surface is fixed and hugs the
      // trigger through a measured offset instead of document flow.
      React.useLayoutEffect(function () {
        if (!isOpen) return
        var place = function () {
          var node = rootRef.current
          if (!node || typeof node.getBoundingClientRect !== 'function') return
          var rect = node.getBoundingClientRect()
          var height = typeof window !== 'undefined' ? window.innerHeight : 0
          var width = typeof window !== 'undefined' ? window.innerWidth : 0
          var left = Math.max(8, Math.min(rect.left, width - 368))
          setAnchor({ left: left, bottom: Math.max(8, height - rect.top + 8) })
        }
        place()
        if (typeof window === 'undefined') return undefined
        window.addEventListener('resize', place)
        return function () { window.removeEventListener('resize', place) }
      }, [isOpen])

      React.useEffect(function () {
        if (!isOpen) return undefined
        var onPointer = function (event) {
          var node = rootRef.current
          if (node && event.target instanceof Node && node.contains(event.target)) return
          setOpen(false)
        }
        var onKey = function (event) {
          if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('pointerdown', onPointer, true)
        document.addEventListener('keydown', onKey)
        return function () {
          document.removeEventListener('pointerdown', onPointer, true)
          document.removeEventListener('keydown', onKey)
        }
      }, [isOpen])

      var body = [
        h(
          'div',
          { key: 'head', style: PANEL_HEAD },
          h('span', { style: PANEL_TITLE }, t('panelTitle')),
          h('button', {
            key: 'close', type: 'button', style: BTN_QUIET,
            onClick: function () { setOpen(false) },
          }, t('close')),
        ),
      ]

      if (notice.pending) {
        body.push(h(
          'div',
          { key: 'notice', style: SECTION, role: 'status' },
          h('div', { style: { fontWeight: 500, marginBottom: '4px', color: C.label } }, t('noticeTitle')),
          h('p', { style: HINT_LINE }, t('noticeBody')),
          h('button', {
            key: 'dismiss', type: 'button',
            style: Object.assign({}, BTN_QUIET, { paddingLeft: 0 }),
            onClick: function () {
              props.dismissNotice()
              if (status.phase !== 'error') setOpen(false)
            },
          }, t('noticeDismiss')),
        ))
      }

      if (status.phase === 'opening') {
        body.push(h('p', { key: 'opening', style: HINT }, t('opening')))
      }

      if (status.phase === 'error') {
        body.push(h(
          'div',
          { key: 'error', style: ERROR_BOX, role: 'alert' },
          h('span', null, errorText(t, status)),
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
        ))
      }

      if (status.showDiagnostics) {
        body.push(h(
          'div',
          { key: 'checks', style: SECTION },
          h('div', { style: { fontWeight: 500, marginBottom: '4px' } }, t('diagnosticsTitle')),
          diagnosticLines(t).map(function (line, index) {
            return h('p', { key: index, style: HINT_LINE }, line)
          }),
        ))
      }

      return h(
        'div',
        { ref: rootRef, style: wide ? LAYER_WIDE : LAYER_RAIL, 'data-plugin': NS },
        isOpen && anchor !== undefined
          ? h(
              'section',
              { style: Object.assign({}, PANEL, anchor), 'aria-label': t('panelTitle'), 'data-dsh-deepseek-web-panel': '' },
              body,
            )
          : null,
        h(
          'button',
          {
            type: 'button',
            style: wide ? BADGE : BADGE_RAIL,
            title: t('buttonHint'),
            'aria-label': t('buttonHint'),
            'aria-busy': status.phase === 'opening',
            'data-dsh-deepseek-web-trigger': '',
            'data-busy': status.phase === 'opening' ? '' : undefined,
            onClick: function () {
              if (props.activate()) setOpen(true)
            },
          },
          h(Icon),
          wide ? h('span', { style: BADGE_LABEL }, t('trigger')) : null,
        ),
      )
    }

    // ------------------------------------------------------------ settings page

    /** Read a scope snapshot without letting a disposed scope throw. */
    function readSnapshot(scope) {
      if (!scope || typeof scope.getSnapshot !== 'function') return undefined
      try {
        var snapshot = scope.getSnapshot()
        return snapshot && typeof snapshot === 'object' ? snapshot : undefined
      } catch (error) {
        return undefined
      }
    }

    /** Whether the stored overrides carry `key`. */
    function hasOwn(target, key) {
      return target !== null && typeof target === 'object' &&
        Object.prototype.hasOwnProperty.call(target, key)
    }

    var PAGE = {
      boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '16px',
      maxWidth: '760px', color: C.label, fontFamily: 'inherit',
      fontSize: '13px', lineHeight: '20px',
    }
    var FIELD = { display: 'flex', flexDirection: 'column', gap: '6px' }
    var PAGE_TITLE = { margin: 0, fontSize: '15px', fontWeight: 600, lineHeight: '22px' }
    var FIELD_LABEL = { fontWeight: 500 }
    var INPUT = {
      boxSizing: 'border-box', width: '100%', padding: '7px 10px',
      border: '1px solid ' + C.border, borderRadius: C.radius,
      background: 'transparent', color: C.label, fontFamily: 'inherit',
      fontSize: '13px', lineHeight: '20px',
    }
    var FLAGS = { display: 'flex', flexDirection: 'column', gap: '10px' }
    var FLAG_ROW = { display: 'flex', alignItems: 'flex-start', gap: '8px' }
    var ACTIONS = { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }
    var PRIMARY_BTN = Object.assign({}, BTN, { padding: '5px 14px', borderColor: C.link, color: C.link })
    var LINK_BTN = {
      padding: 0, border: 'none', background: 'transparent', color: C.link,
      fontFamily: 'inherit', fontSize: '12px', lineHeight: '18px', cursor: 'pointer',
    }

    /**
     * The bundle's own configuration page.
     *
     * It occupies the two keyed seats a bundle's settings can take in the
     * Plugins tab, so the owner wraps it in nothing: the page draws its own
     * heading and save control. Every write goes through the Host revision, and
     * `view: 'summary'` is the one line the page lists about the bundle.
     */
    function SettingsPage(props) {
      var t = typeof props.t === 'function' ? props.t : function (key) { return key }
      var scope = props.scope

      var snapPair = React.useState(function () { return readSnapshot(scope) })
      var snapshot = snapPair[0]
      var setSnapshot = snapPair[1]

      var draftPair = React.useState(null)
      var draft = draftPair[0]
      var setDraft = draftPair[1]

      var busyPair = React.useState(false)
      var busy = busyPair[0]
      var setBusy = busyPair[1]

      var noticePair = React.useState(null)
      var notice = noticePair[0]
      var setNotice = noticePair[1]

      React.useEffect(function () {
        if (!scope) return undefined
        var alive = true
        var update = function () { if (alive) setSnapshot(readSnapshot(scope)) }
        var off
        try {
          off = typeof scope.subscribe === 'function' ? scope.subscribe(update) : undefined
        } catch (error) { off = undefined }
        update()
        return function () {
          alive = false
          if (typeof off === 'function') {
            try { off() } catch (error) { /* already released */ }
          }
        }
      }, [scope])

      if (props.view === 'summary') return t('settingsSummary')

      if (snapshot === undefined) {
        return h('p', { style: HINT }, t('unavailable'))
      }

      var value = snapshot.value && typeof snapshot.value === 'object' ? snapshot.value : {}
      var writable = snapshot.writable === true
      var disabled = !writable || busy
      var fields = draft === null ? null : draft

      var text = function (key) {
        if (fields !== null && typeof fields[key] === 'string') return fields[key]
        return typeof value[key] === 'string' ? value[key] : ''
      }
      var flag = function (key, fallback) {
        if (fields !== null && typeof fields[key] === 'boolean') return fields[key]
        return typeof value[key] === 'boolean' ? value[key] : fallback
      }

      var edit = function (key, next) {
        var base = fields === null ? {} : fields
        var copy = {}
        for (var name in base) if (Object.prototype.hasOwnProperty.call(base, name)) copy[name] = base[name]
        copy[key] = next
        setDraft(copy)
      }

      var submit = function (ops, done) {
        if (!writable) { setNotice({ ok: false, text: t('readOnly') }); return }
        if (!scope || typeof scope.mutate !== 'function') {
          setNotice({ ok: false, text: t('unavailable') })
          return
        }
        setBusy(true)
        setNotice(null)
        var landed
        try {
          landed = scope.mutate(ops, snapshot.revision)
        } catch (error) {
          setBusy(false)
          setNotice({ ok: false, text: t('rejected') })
          return
        }
        Promise.resolve(landed).then(function (accepted) {
          setBusy(false)
          if (accepted) {
            if (typeof done === 'function') done()
            setSnapshot(readSnapshot(scope))
            setNotice({ ok: true, text: t('saved') })
            return
          }
          setNotice({ ok: false, text: t('rejected') })
        }, function (error) {
          setBusy(false)
          var code = error && (error.code || (error.cause && error.cause.code))
          setNotice({ ok: false, text: code === 'SETTINGS_CONFLICT' ? t('conflict') : t('rejected') })
        })
      }

      var save = function () {
        if (fields === null) return
        var ops = []
        var put = function (key, next) {
          ops.push({ op: 'set', path: [key], value: next })
        }
        if (typeof fields.url === 'string') put('url', fields.url.trim() === '' ? DEFAULT_URL : fields.url.trim())
        if (typeof fields.reuseExistingTab === 'boolean') put('reuseExistingTab', fields.reuseExistingTab)
        if (typeof fields.registerShortcut === 'boolean') put('registerShortcut', fields.registerShortcut)
        if (typeof fields.autoFill === 'boolean') put('autoFill', fields.autoFill)
        if (typeof fields.account === 'string') put('account', fields.account.trim())
        // An empty password box keeps the stored one, so the page never has to
        // echo a secret back into the browser to keep it.
        if (typeof fields.password === 'string' && fields.password !== '') put('password', fields.password)
        if (ops.length === 0) return
        submit(ops, function () { setDraft(null) })
      }

      var clearPassword = function () {
        submit([{ op: 'unset', path: ['password'] }], function () { setDraft(null) })
      }

      var textField = function (key, label, hint, extra) {
        return h(
          'div',
          { style: FIELD, key: key },
          h('label', { style: FIELD_LABEL, htmlFor: 'dsh-deepseek-web-' + key }, label),
          h('input', Object.assign({
            id: 'dsh-deepseek-web-' + key,
            type: 'text',
            style: INPUT,
            value: text(key),
            disabled: disabled,
            spellCheck: false,
            autoComplete: 'off',
            onChange: function (event) { edit(key, event.target.value) },
          }, extra || {})),
          h('p', { style: HINT }, hint),
        )
      }

      var flagField = function (key, fallback, label, hint) {
        return h(
          'label',
          { style: FLAG_ROW, key: key },
          h('input', {
            type: 'checkbox',
            checked: flag(key, fallback),
            disabled: disabled,
            onChange: function (event) { edit(key, event.target.checked) },
          }),
          h(
            'span',
            null,
            h('span', { style: FIELD_LABEL }, label),
            h('br'),
            h('span', { style: HINT }, hint),
          ),
        )
      }

      // Whether a password is already stored. The rendered value may be absent
      // because the Host strips `role('secret')` fields on the wire; the
      // overrides layer still reports the key, so presence is what counts.
      var overrides = snapshot.user && typeof snapshot.user === 'object' ? snapshot.user : undefined
      var stored = overrides !== undefined && hasOwn(overrides, 'password')
        ? overrides.password !== '' && overrides.password !== undefined
        : typeof value.password === 'string' && value.password !== ''

      return h(
        'div',
        { style: PAGE, 'data-plugin-config': NS },
        h(
          'div',
          { style: FIELD },
          h('h3', { style: PAGE_TITLE }, t('settingsTitle')),
          h('p', { style: HINT }, t('settingsSummary')),
        ),
        textField('url', t('urlLabel'), t('urlHint'), { placeholder: DEFAULT_URL, type: 'url' }),
        h(
          'div',
          { style: FLAGS },
          flagField('reuseExistingTab', true, t('reuseLabel'), t('reuseHint')),
          flagField('registerShortcut', true, t('shortcutSwitchLabel'), t('shortcutSwitchHint')),
          flagField('autoFill', true, t('autoFillLabel'), t('autoFillHint')),
        ),
        textField('account', t('accountLabel'), t('accountHint'), { autoComplete: 'username' }),
        h(
          'div',
          { style: FIELD },
          h('label', { style: FIELD_LABEL, htmlFor: 'dsh-deepseek-web-password' }, t('passwordLabel')),
          h('input', {
            id: 'dsh-deepseek-web-password',
            type: 'password',
            style: INPUT,
            // The stored secret is never echoed back into the field: an empty
            // box means "keep what is stored", which is also how a user clears
            // it deliberately (the paid-off button below).
            value: fields !== null && typeof fields.password === 'string' ? fields.password : '',
            disabled: disabled,
            spellCheck: false,
            autoComplete: 'new-password',
            placeholder: stored ? t('passwordStored') : t('passwordMissing'),
            onChange: function (event) { edit('password', event.target.value) },
          }),
          h('p', { style: HINT }, t('passwordHint')),
        ),
        h(
          'p',
          { style: HINT },
          t('effective') + '：' + (typeof value.url === 'string' && value.url !== '' ? value.url : DEFAULT_URL) +
            (hasOwn(snapshot.user, 'url') ? ' · ' + t('overridden') : ''),
        ),
        h(
          'div',
          { style: ACTIONS },
          h('button', {
            type: 'button',
            style: disabled ? Object.assign({}, PRIMARY_BTN, { opacity: 0.55 }) : PRIMARY_BTN,
            disabled: disabled || fields === null,
            onClick: save,
          }, busy ? t('saving') : t('save')),
          fields === null
            ? null
            : h('button', {
                type: 'button', style: LINK_BTN, disabled: busy,
                onClick: function () { setDraft(null); setNotice(null) },
              }, t('discard')),
          stored
            ? h('button', {
                type: 'button', style: LINK_BTN, disabled: disabled,
                onClick: clearPassword,
              }, t('passwordClear'))
            : null,
          notice === null
            ? null
            : h('span', {
                style: { color: notice.ok ? C.secondary : C.warn, fontSize: '12px', lineHeight: '18px' },
                role: 'status',
              }, notice.text),
        ),
      )
    }

    // ------------------------------------------------------------------ apply

    function apply(ctx) {
      var t = makeReader(ctx)
      if (!ctx.slots || typeof ctx.slots.inject !== 'function') {
        console.error('dsh-deepseek-web: no slots service; the sidebar action stays unmounted')
        return
      }
      var controller = createController(ctx)
      notice.pending = probeNotice()

      // Host configuration is optional. Request the service at runtime so a
      // client without a settings projection still mounts the action.
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

              // The Host serves this namespace, so the Plugins tab can host the
              // page. Both seats are keyed slots: the owner draws no heading of
              // its own around them, so the page carries its own.
              var stops = []
              var face = function () { return { t: t, scope: scope } }
              var seats = [
                ['plugins.bundle.config', BUNDLE_KEY],
                ['plugins.row.config', ROW_KEY],
              ]
              for (var index = 0; index < seats.length; index += 1) {
                try {
                  stops.push(ctx.slots.inject(seats[index][0], (function (name, key) {
                    return function () {
                      return ctx.slots.register({ name: name, key: key, locale: DICT, inject: face }, SettingsPage)
                    }
                  })(seats[index][0], seats[index][1])))
                } catch (error) {
                  console.warn('dsh-deepseek-web: registering the settings page failed', error)
                }
              }

              return function () {
                if (typeof off === 'function') off()
                for (var at = 0; at < stops.length; at += 1) {
                  try {
                    if (typeof stops[at] === 'function') stops[at]()
                  } catch (error) { /* A released slot needs no second release. */ }
                }
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
                  return { status: 'handled', run: function () { controller.open() } }
                },
              })
            }, 'dsh-deepseek-web: shortcut')
          })
        }
      } catch (error) {
        console.warn('dsh-deepseek-web: shortcut registration failed', error)
      }

      // The drop target needs a session on screen to have an input to quote
      // into, so it lives in a session-scoped seat and draws nothing on its own.
      // The same listener owns the new-session path, which needs the context.
      try {
        ctx.slots.inject(DROP_SLOT, function () {
          return ctx.slots.register({
            name: DROP_SLOT,
            id: NS + '-drop',
            order: 90,
            locale: DICT,
            inject: function () {
              return {
                t: t,
                getWorkspace: function () {
                  try {
                    return typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined
                  } catch (error) {
                    return undefined
                  }
                },
              }
            },
          }, DropTarget)
        })
      } catch (error) {
        console.warn('dsh-deepseek-web: registering the drop target failed', error)
      }

      try {
        ctx.slots.inject(FOOTER_SLOT, function () {
          return ctx.slots.register({
            name: FOOTER_SLOT,
            id: NS,
            order: 60,
            locale: DICT,
            inject: function () {
              return {
                t: t,
                // The button is the action: it opens and reports whether the
                // first-run note also has to be shown.
                activate: function () {
                  controller.open()
                  return notice.pending
                },
                retry: controller.retry,
                toggleDiagnostics: controller.toggleDiagnostics,
                dismissNotice: dismissNotice,
              }
            },
          }, Panel)
        })
      } catch (error) {
        console.error('dsh-deepseek-web: registering the sidebar action failed', error)
      }

      ctx.effect(function () { return clearTimers }, 'dsh-deepseek-web: timers')
      ctx.effect(function () { return installStyle() }, 'dsh-deepseek-web: styles')
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale', 'sidebarRight']
    exports.name = NS
    return module.exports
  },
})
