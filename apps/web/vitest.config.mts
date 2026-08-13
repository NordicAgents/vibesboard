import { fileURLToPath } from 'node:url'
import { defineProject } from 'vitest/config'
import { sharedResolveAlias, sharedTest } from '../../vitest.shared.mts'

// Map the `@/<path>` alias (matching apps/web/tsconfig.json's `"@/*": ["./*"]`)
// to the app root. A regex find/replacement (`/^@\//` -> `<appRoot>/`) is the
// reliable form: a plain `'@'` string-key object alias was not matched as a
// prefix for `@/lib/...` imports by this vitest version, so route handlers that
// import via `@/lib/...` (e.g. webhook verification) failed to resolve.
// `appRoot` has no trailing slash so the replacement yields exactly one `/`.
const appRoot = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '')

export default defineProject({
  resolve: {
    alias: [
      ...Object.entries(sharedResolveAlias).map(([find, replacement]) => ({
        find,
        replacement,
      })),
      { find: /^@\//, replacement: `${appRoot}/` },
    ],
  },
  test: {
    ...sharedTest,
    name: 'web',
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['{lib,app,components}/**/*.test.{ts,tsx}'],
  },
})
