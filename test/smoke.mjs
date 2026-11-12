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
check('client has an error state machine', /no-browser/.test(client) && /not-appeared/.test(client))
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

function mount(configValue) {
  const opened = [], focused = [], registered = [], shortcuts = []
  const tabs = [{ sessionId: 's1', tabId: 't1', kind: 'browser', contentId: 'c1' }]
  let api = null
  const effect = (fn) => {
    const disposer = fn()
    return typeof disposer === 'function' ? disposer : () => {}
  }
  const ctx = {
    locale: { register: () => () => {}, bind: () => (key) => key },
    slots: {
      inject: (_name, callback) => { callback(); return () => {} },
      register: (options) => {
        api = typeof options.inject === 'function' ? options.inject() : null
        registered.push(options)
        return () => {}
      },
    },
    sidebarRight: {
      openTabs: { getSnapshot: () => tabs },
      openTab: (kind, options) => { opened.push({ kind, options }) },
      focus: (tabId) => { focused.push(tabId) },
    },
    effect,
    inject: (names, callback) => {
      if (names[0] === 'configForms' && configValue !== undefined) {
        callback({
          configForms: {
            get: () => ({
              getSnapshot: () => ({ value: configValue }),
              subscribe: () => () => {},
            }),
          },
          effect,
        })
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
  return { api, opened, focused, registered, shortcuts, tabs, threw }
}

if (runtimeModule !== null) {
  const plain = mount(undefined)
  check('apply mounts with optional services absent', plain.threw === null,
    plain.threw ? plain.threw.message : '')
  check('launcher registered in the composer dock',
    plain.registered.some((entry) => entry.name === 'conversation.composer.dock' &&
      entry.id === 'dsh-deepseek-web'))
  check('slot inject exposes the public API',
    plain.api !== null && typeof plain.api.open === 'function' &&
    typeof plain.api.retry === 'function')
  check('shortcut registered', plain.shortcuts.length === 1 &&
    plain.shortcuts[0].id === 'dsh-deepseek-web.open')

  const configured = mount({
    url: 'https://chat.deepseek.com',
    reuseExistingTab: true,
    registerShortcut: true,
  })
  check('configForms path mounts', configured.threw === null,
    configured.threw ? configured.threw.message : '')
  if (configured.api !== null) {
    configured.api.open(false)
    check('existing browser tab is focused, not duplicated',
      configured.focused.length === 1 && configured.opened.length === 0)
    configured.tabs.length = 0
    configured.api.open(true)
    check('new tab navigates to the configured URL',
      configured.opened.length === 1 &&
      configured.opened[0].kind === 'browser' &&
      configured.opened[0].options.params.url === 'https://chat.deepseek.com/')
  }

  warnings.length = 0
  const invalid = mount({
    url: 'file:///windows/win.ini',
    reuseExistingTab: true,
    registerShortcut: false,
  })
  if (invalid.api !== null) {
    invalid.api.open(false)
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
