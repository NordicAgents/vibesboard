// Per-package Vitest config for @vibesboard/policy.
//
// Spreads the monorepo-wide `sharedTest` options and applies
// `sharedResolveAlias` (so `server-only`/`client-only` resolve to no-op stubs).
// Works both standalone (`vitest run` inside this dir) and as a project of the
// root config via `test.projects`.
import { fileURLToPath } from 'node:url'
import { defineProject } from 'vitest/config'
import { sharedResolveAlias, sharedTest } from '../../vitest.shared'

export default defineProject({
  // Alias placement: project-level `resolve.alias`, NOT under `test`.
  resolve: { alias: sharedResolveAlias },
  test: {
    ...sharedTest,
    name: 'policy',
    // Pin the project root to this package so `vitest run` here resolves the
    // same `include` globs whether run standalone or aggregated.
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['src/**/*.test.ts'],
  },
})
