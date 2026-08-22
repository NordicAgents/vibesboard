/**
 * Which edition this deployment runs as.
 *
 * Mirrors Chatwoot's `ChatwootApp.enterprise?`: the enterprise code path is
 * opt-in, and one environment variable force-disables it regardless of
 * anything else.
 *
 *   DISABLE_ENTERPRISE=true        → always 'community' (hard kill switch)
 *   VIBESBOARD_EDITION=enterprise  → 'enterprise'
 *   anything else                  → 'community' (the default)
 *
 * Build-time presence of the `ee/` directory is a *separate* concern, handled
 * by the bundler alias in apps/web/next.config.mjs. A distribution built with
 * `ee/` deleted resolves the enterprise module to a stub, at which point this
 * flag becomes inert and the community implementation is used either way.
 */

export type Edition = 'community' | 'enterprise'

export interface EditionEnv {
  DISABLE_ENTERPRISE?: string | undefined
  VIBESBOARD_EDITION?: string | undefined
  // Index signature so `process.env` (NodeJS.ProcessEnv) is assignable —
  // without it TypeScript's weak-type check rejects an all-optional interface.
  [key: string]: string | undefined
}

export function resolveEdition(env: EditionEnv = process.env): Edition {
  // Kill switch wins over everything, so an operator can always fall back to
  // the community path without rebuilding.
  if (env.DISABLE_ENTERPRISE === 'true') return 'community'
  return env.VIBESBOARD_EDITION === 'enterprise' ? 'enterprise' : 'community'
}

export function isEnterprise(env: EditionEnv = process.env): boolean {
  return resolveEdition(env) === 'enterprise'
}
