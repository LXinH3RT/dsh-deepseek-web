// Host half of dsh-deepseek-web.
//
// The visible surface is entirely client-side: this bundle contributes an action
// at the sidebar foot and a shortcut, both of which open the shipped
// right-Sidebar Browser tab. Nothing in the Host needs to run, so
// `apply` is intentionally empty — but the module must exist because the
// Loader row points at it.
//
// The Host does own the configuration schema. `@deepseek-ai/schemastery` is an
// optional peer dependency supplied by a real DSH profile; a soft import keeps
// this module loadable in a plain Node process (the smoke test) where it is
// absent. Without a builder there is no settings projection, and the Client
// half falls back to its own defaults.

export const name = 'dsh-deepseek-web'

let Schema = null
try {
  const namespace = await import('@deepseek-ai/schemastery')
  for (const candidate of [namespace.Schema, namespace.default?.Schema, namespace.default]) {
    if (candidate && typeof candidate.object === 'function') {
      Schema = candidate
      break
    }
  }
} catch {
  Schema = null
}

/**
 * Build the settings schema. Every leaf is `.volatile()`: the settings service
 * only projects a config entry into a form through `volatileForm()`, and a
 * nested volatile inside another volatile contributes no field. Keep this a
 * flat object.
 */
export function buildConfig(builder) {
  if (!builder || typeof builder.object !== 'function') return undefined
  try {
    return builder.object({
      url: builder.string().default('https://chat.deepseek.com').volatile(),
      reuseExistingTab: builder.boolean().default(true).volatile(),
      registerShortcut: builder.boolean().default(true).volatile(),
    })
  } catch {
    return undefined
  }
}

export const Config = buildConfig(Schema)

export function apply() {}
