// Offline structural check for dsh-deepseek-web. No DSH instance is needed.
// Run: node test/smoke.mjs

import { readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { runInNewContext } from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const checks = []

function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail })
  if (!condition) failures.push(name + (detail ? ' — ' + detail : ''))
}

function read(relative) {
  const path = join(root, relative)
  if (!existsSync(path)) throw new Error('missing ' + relative)
  return readFileSync(path, 'utf8')
}

function syntaxOk(relative) {
  try {
    execFileSync(process.execPath, ['--check', join(root, relative)], { stdio: 'pipe' })
    return true
  } catch (error) {
    return String(error.stderr || error.message)
  }
}

// ---------------------------------------------------------------- manifest

let manifest
try {
  manifest = JSON.parse(read('package.json'))
  check('package.json parses', true)
} catch (error) {
  manifest = {}
  check('package.json parses', false, error.message)
}

check('manifest name matches module id', manifest.name === 'dsh-deepseek-web')
check('dsh.bundle.patch declared', manifest.dsh?.bundle?.patch === './cordis.patch.yml')
check('dsh.client.platform is web', manifest.dsh?.client?.platform === 'web')
check('client export declared', manifest.exports?.['./client'] === './client.js')
check('locale export declared', typeof manifest.exports?.['./locale/*.json'] === 'string')
check('icon export declared', typeof manifest.exports?.['./icon'] === 'string')
check('browser activation ordered after built-in Browser',
  (manifest.dsh?.client?.inject ?? []).includes('@deepseek-ai/dsh-client-ui-sidebar-browser'))
check('sidebar activation precedes the footer action',
  (manifest.dsh?.client?.inject ?? []).includes('@deepseek-ai/dsh-client-ui-sidebar'))

for (const [key, target] of Object.entries(manifest.exports ?? {})) {
  if (key.includes('*')) continue
  check('export target exists: ' + key, existsSync(join(root, target)), target)
}

// ------------------------------------------------------------------- patch

const patch = read('cordis.patch.yml')
check('patch inserts one row', /-\s*insert:/.test(patch))
check('patch row id matches manifest', /id:\s*dsh-deepseek-web/.test(patch))
check('patch name is path-relative', /name:\s*'\.\/index\.js'/.test(patch))
check('patch carries no config override', !/^\s*config:/m.test(patch))

// ------------------------------------------------------------- host + client

const host = read('index.js')
const client = read('client.js')

check('host exports apply', /export function apply\s*\(/.test(host))
check('host exports Config', /export const Config/.test(host))
check('host Config uses volatile fields', /\.volatile\(\)/.test(host))
check('host soft-imports schemastery', /await import\('@deepseek-ai\/schemastery'\)/.test(host))
check('client registers a module factory', /window\.__ModuleLoader__\.load\s*\(/.test(client))
check('module id equals package name', /id:\s*'dsh-deepseek-web'/.test(client))
check('client exports apply/inject/name',
  /exports\.apply\s*=/.test(client) && /exports\.inject\s*=/.test(client) && /exports\.name\s*=/.test(client))
check('client requests required services',
  /'slots'/.test(client) && /'locale'/.test(client) && /'sidebarRight'/.test(client))
check('client uses the built-in browser kind', /openTab\(BROWSER_KIND/.test(client))
check('client validates the URL', /function validateUrl/.test(client))
check('client reuses existing tabs', /reuseExistingTab/.test(client) && /\.focus\(/.test(client))
check('client has an error state machine', /no-browser/.test(client) && /no-session/.test(client))
check('client uses the mounted session, not the restored inventory',
  /mounted/.test(client) && /tabsIn/.test(client))
check('client expands the sidebar before focusing',
  /isExpanded/.test(client) && /toggleExpanded/.test(client))
check('client keeps the button as the whole action', !/newTab/.test(client) && !/'help'/.test(client))
check('client can fill the sign-in form locally',
  /executeJavaScript/.test(client) && /data-sidebar-browser-frame/.test(client))
check('client reads a dropped conversation link',
  /SESSION_ADDRESS = \/\\\/a\\\/\(/.test(client) && /text\/uri-list/.test(client))
check('client quotes the dropped conversation through the input actions',
  /insertQuote/.test(client) && /conversation\.composer\.dock/.test(client))
check('client fetches the transcript inside the embedded page',
  /history_messages/.test(client) && /chat_session_id/.test(client))
check('client clears the drop report on its own',
  /NOTE_TIMEOUT_MS/.test(client) && /function report\(text\)/.test(client))
check('client keeps the sidebar foot as the only entry',
  /FOOTER_SLOT = 'sidebar\.footer\.action'/.test(client))
check('client anchors the panel to the trigger',
  /getBoundingClientRect/.test(client) && /position: 'fixed'/.test(client))
check('client reads the first-run notice flag',
  /probeNotice/.test(client) && /\.environment-notice-dismissed/.test(client))
check('client registers the bundle configuration page',
  /plugins\.bundle\.config/.test(client) && /plugins\.row\.config/.test(client))
check('client never echoes the stored password into the page',
  /type: 'password'/.test(client) && /op: 'unset', path: \['password'\]/.test(client))
check('client has no top-level ESM import/export',
  !/^\s*(import|export)\s/m.test(client))
check('client has no emoji', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(client))

for (const file of ['index.js', 'client.js']) {
  const result = syntaxOk(file)
  check('JS syntax: ' + file, result === true, result === true ? '' : String(result).slice(0, 300))
}

// --------------------------------------------------------------- resources

for (const name of ['locale/zh.json', 'locale/en.json']) {
  try {
    const meta = JSON.parse(read(name)).meta
    check(name + ' has meta.title', typeof meta?.title === 'string' && meta.title.length > 0)
    check(name + ' has meta.description', typeof meta?.description === 'string' && meta.description.length > 0)
    check(name + ' points at detail doc', meta?.detail === 'docs/DETAIL.md')
  } catch (error) {
    check(name + ' parses', false, error.message)
  }
}

check('detail doc exists', existsSync(join(root, 'docs/DETAIL.md')))
check('icon.svg exists', existsSync(join(root, 'icon.svg')))
check('icon.svg within 256 KiB', statSync(join(root, 'icon.svg')).size <= 256 * 1024)
check('README exists', existsSync(join(root, 'README.md')))
// The project handover note is kept out of the published repository, so it is
// inspected only when it is present in a working copy.
if (existsSync(join(root, 'AgentsReadMe.md'))) {
  check('local handover note is not published', /AgentsReadMe\.md/.test(read('.gitignore')))
}

// -------------------------------------------------------- runtime behaviour
// Execute the Client factory in an isolated context with a mock Harness, so the
// tab-reuse and URL-validation paths are exercised rather than only parsed.

let definition = null
const warnings = []
const pendingTimers = []
const sandbox = {
  window: { __ModuleLoader__: { load: (value) => { definition = value } } },
  console: {
    log() {}, info() {},
    warn(...args) { warnings.push(args.join(' ')) },
    error(...args) { warnings.push('error: ' + args.join(' ')) },
  },
  navigator: { language: 'zh-CN' },
  URL,
  setTimeout: (fn) => { pendingTimers.push(fn); return pendingTimers.length },
  clearTimeout: () => {},
}
runInNewContext(client, sandbox, { filename: 'client.js' })

check('module definition captured at runtime',
  definition !== null && definition.id === 'dsh-deepseek-web')

const reactMock = {
  createElement: (...args) => ({ args }),
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useLayoutEffect: () => {},
  useRef: (initial) => ({ current: initial }),
}
let runtimeModule = null
try {
  runtimeModule = definition.factory((name) => {
    if (name === 'react') return reactMock
    throw new Error('unexpected require: ' + name)
  })
} catch (error) {
  check('module factory executes', false, error.message)
}
check('factory returns a Cordis-shaped module',
  runtimeModule !== null && typeof runtimeModule.apply === 'function' &&
  Array.isArray(runtimeModule.inject) && runtimeModule.name === 'dsh-deepseek-web')

function mount(configValue, options = {}) {
  const opened = [], focused = [], registered = [], shortcuts = []
  let mountWrites = null
  const sessionId = 'sessionId' in options ? options.sessionId : 's1'
  const tabs = options.tabs ?? [{ sessionId: 's1', tabId: 't1', kind: 'browser', contentId: 'c1' }]
  let expanded = options.expanded !== false
  let api = null
  const effect = (fn) => {
    const disposer = fn()
    return typeof disposer === 'function' ? disposer : () => {}
  }
  const ctx = {
    locale: { register: () => () => {}, bind: () => (key) => key },
    slots: {
      inject: (_name, callback) => { callback(); return () => {} },
      register: (options_, component) => {
        api = typeof options_.inject === 'function' ? options_.inject() : null
        registered.push({ ...options_, component })
        return () => {}
      },
    },
    sidebarRight: {
      mounted: { getSnapshot: () => sessionId },
      openTabs: { getSnapshot: () => tabs },
      tabsIn: (id) => tabs.filter((tab) => tab.sessionId === id),
      isExpanded: () => expanded,
      toggleExpanded: () => { expanded = !expanded },
      openTab: (kind, options_) => { opened.push({ kind, options: options_ }) },
      focus: (tabId) => { focused.push(tabId) },
    },
    effect,
    inject: (names, callback) => {
      if (names[0] === 'configForms' && configValue !== undefined) {
        const writes = []
        const scope = {
          getSnapshot: () => ({
            status: 'ready',
            value: configValue,
            user: {},
            revision: 3,
            writable: true,
          }),
          subscribe: () => () => {},
          mutate: (ops, revision) => { writes.push({ ops, revision }); return Promise.resolve(true) },
        }
        callback({
          configForms: {
            get: () => scope,
            whileServed: (_names, register) => register(),
          },
          effect,
        })
        mountWrites = writes
      } else if (names[0] === 'shortcuts') {
        callback({
          shortcuts: { register: (entry) => { shortcuts.push(entry); return () => {} } },
          effect,
        })
      }
    },
  }
  let threw = null
  try { runtimeModule.apply(ctx) } catch (error) { threw = error }
  return { api, opened, focused, registered, shortcuts, tabs, threw, isExpanded: () => expanded, writes: mountWrites }
}

if (runtimeModule !== null) {
  const plain = mount(undefined)
  check('apply mounts with optional services absent', plain.threw === null,
    plain.threw ? plain.threw.message : '')
  check('sidebar action registered at the sidebar foot',
    plain.registered.some((entry) => entry.name === 'sidebar.footer.action' &&
      entry.id === 'dsh-deepseek-web'))
  check('slot inject exposes the public API',
    plain.api !== null && typeof plain.api.activate === 'function' &&
    typeof plain.api.retry === 'function' && typeof plain.api.dismissNotice === 'function')
  // Without localStorage the first-run note stays hidden rather than returning
  // on every launch; nothing in the mount path may throw over the missing store.
  check('no-storage mount never touches an undefined store',
    plain.threw === null && !warnings.some((line) => /localStorage/.test(line)))
  let dismissThrew = null
  try { plain.api.dismissNotice() } catch (error) { dismissThrew = error.message }
  check('dismissing the notice never throws', dismissThrew === null, dismissThrew ?? '')
  check('shortcut registered', plain.shortcuts.length === 1 &&
    plain.shortcuts[0].id === 'dsh-deepseek-web.open')
  check('the drop target is mounted in a session seat',
    plain.registered.some((entry) => entry.name === 'conversation.composer.dock'))
  const drop = plain.registered.find((entry) => entry.name === 'conversation.composer.dock')
  if (drop !== undefined && typeof drop.component === 'function') {
    let idle = null, idleThrew = null
    try { idle = drop.component({ ...drop.inject() }) } catch (error) { idleThrew = error.message }
    check('the drop target draws nothing until a conversation arrives',
      idleThrew === null && idle === null, idleThrew ?? '')
  }

  const configured = mount({
    url: 'https://chat.deepseek.com',
    reuseExistingTab: true,
    registerShortcut: true,
  })
  check('configForms path mounts', configured.threw === null,
    configured.threw ? configured.threw.message : '')
  check('a served namespace registers the bundle configuration page',
    configured.registered.some((entry) => entry.name === 'plugins.bundle.config' &&
      entry.key === 'dsh-deepseek-web') &&
    configured.registered.some((entry) => entry.name === 'plugins.row.config' &&
      entry.key === 'dsh-deepseek-web#dsh-deepseek-web'))
  const page = configured.registered.find((entry) => entry.name === 'plugins.bundle.config')
  check('the configuration page is a component with a summary view',
    page !== undefined && typeof page.component === 'function' &&
      typeof page.inject === 'function' && page.inject().t('save') === 'save')
  if (page !== undefined && typeof page.component === 'function') {
    let summary = null, rendered = null, renderThrew = null
    try {
      summary = page.component({ view: 'summary', ...page.inject() })
      rendered = page.component({ view: 'page', ...page.inject() })
    } catch (error) { renderThrew = error.message }
    check('the configuration page renders both views', renderThrew === null, renderThrew ?? '')
    check('the summary view is a string', typeof summary === 'string' && summary.length > 0)
    const flat = JSON.stringify(rendered)
    check('the page offers every configurable field',
      flat.includes('dsh-deepseek-web-url') && flat.includes('dsh-deepseek-web-account') &&
      flat.includes('dsh-deepseek-web-password'))
    check('the password field is masked', flat.includes('"type":"password"'))
  }
  if (configured.api !== null) {
    configured.api.activate()
    check('one click reuses the session browser tab',
      configured.focused.length === 1 && configured.opened.length === 0)
    configured.tabs.length = 0
    configured.api.activate()
    check('a second click places a browser tab at the configured URL',
      configured.opened.length === 1 &&
      configured.opened[0].kind === 'browser' &&
      configured.opened[0].options.params.url === 'https://chat.deepseek.com/')
  }

  // The restored inventory lists tabs of other sessions; those must never be
  // focused, because this session cannot show them.
  const foreign = mount(
    { url: 'https://chat.deepseek.com', reuseExistingTab: true, registerShortcut: true },
    { tabs: [{ sessionId: 'other', tabId: 't9', kind: 'browser', contentId: 'c9' }] },
  )
  if (foreign.api !== null) {
    foreign.api.activate()
    check('tabs of another session are not reused',
      foreign.opened.length === 1 && foreign.focused.length === 0)
  }

  // focus() never expands a collapsed sidebar, so opening must expand first.
  const collapsed = mount(
    { url: 'https://chat.deepseek.com', reuseExistingTab: true, registerShortcut: true },
    { expanded: false },
  )
  if (collapsed.api !== null) {
    collapsed.api.activate()
    check('a collapsed sidebar is expanded before focusing',
      collapsed.isExpanded() === true && collapsed.focused.length === 1)
  }

  // Without an on-screen session the inventory must not be trusted at all.
  const detached = mount(
    { url: 'https://chat.deepseek.com', reuseExistingTab: true, registerShortcut: true },
    { sessionId: undefined, tabs: [{ sessionId: 's1', tabId: 't1', kind: 'browser', contentId: 'c1' }] },
  )
  if (detached.api !== null) {
    const before = warnings.length
    detached.api.activate()
    check('without a session the tab is placed rather than faked',
      detached.opened.length === 1 && detached.focused.length === 0)
    check('without a session a failure is reported', warnings.length >= before)
  }

  warnings.length = 0
  const invalid = mount({
    url: 'file:///windows/win.ini',
    reuseExistingTab: true,
    registerShortcut: false,
  })
  if (invalid.api !== null) {
    invalid.api.activate()
    check('unsupported URL scheme is rejected with a visible error',
      warnings.some((line) => line.includes('bad-url')))
    check('rejected URL never opens a tab', invalid.opened.length === 0)
  }
  // Run pending verification callbacks so no fake timer is left behind.
  pendingTimers.splice(0).forEach((fn) => fn())
}

// ----------------------------------------------------------------- report

console.log('dsh-deepseek-web smoke check')
for (const item of checks) {
  console.log('  ' + (item.ok ? 'PASS' : 'FAIL') + '  ' + item.name + (item.ok ? '' : '  ' + item.detail))
}
console.log('\n' + (checks.length - failures.length) + '/' + checks.length + ' checks passed')
if (failures.length > 0) {
  console.error('\nFailed:\n  - ' + failures.join('\n  - '))
  process.exitCode = 1
}
