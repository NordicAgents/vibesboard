// Root Vitest config: aggregates every package/app that has its own
// `vitest.config.mts` via `projects`, and owns coverage reporting for the
// whole monorepo. Run `vitest run` here for the full suite + coverage.
import { defineConfig } from 'vitest/config'
import { sharedCoverage, sharedResolveAlias } from './vitest.shared.mts'

export default defineConfig({
  resolve: { alias: sharedResolveAlias },
  test: {
    // Glob patterns only match files that exist, so packages/apps that have
    // not yet added a `vitest.config.mts` are silently skipped during the
    // migration. (An explicit path like 'apps/web/vitest.config.mts' would
    // hard-error with "references a non-existing file" until that file exists.)
    projects: ['packages/*/vitest.config.mts', 'apps/*/vitest.config.mts'],
    coverage: sharedCoverage,
  },
})
