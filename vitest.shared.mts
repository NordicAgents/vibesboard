// Shared Vitest configuration for the monorepo.
//
// Each package has its own `vitest.config.mts` that spreads `sharedTest` and
// `sharedResolveAlias` so per-package `vitest run` is scoped to that package,
// while the root `vitest.config.mts` aggregates every package via `projects`.
import { fileURLToPath } from 'node:url'

const fromRoot = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// Alias `server-only` / `client-only` to no-op stubs (Vitest doesn't set the
// `react-server` export condition that production relies on).
export const sharedResolveAlias: Record<string, string> = {
  'server-only': fromRoot('./test/stubs/server-only.ts'),
  'client-only': fromRoot('./test/stubs/client-only.ts'),
}

// Common `test` options. Per-package configs add their own `include`.
//
// DB-backed tests use withTestDb(), which opens short-lived Postgres pools.
// Postgres dev runs with max_connections=100; capping workers keeps total
// connections comfortably under that even when many DB files run at once.
// In Vitest 4 worker counts are top-level (the old `poolOptions.forks` shape
// was removed), so we use maxWorkers/minWorkers directly.
export const sharedTest = {
  environment: 'node' as const,
  globals: false,
  pool: 'forks' as const,
  minWorkers: 1,
  maxWorkers: 4,
  setupFiles: [fromRoot('./test/setup/env.ts')],
  testTimeout: 30_000,
  hookTimeout: 30_000,
}

// Coverage config used at the repo root.
//
// `thresholds` is a ratchet, not a target. The numbers sit a couple of points
// below the coverage measured when they were introduced (statements 21.42,
// branches 20.40, functions 23.06, lines 21.70), so the suite passes today but
// CI fails on a real regression. The headroom absorbs ordinary run-to-run
// drift; it is not licence to let coverage sink to the floor. Raise these
// whenever a batch of tests lands — that is the point of a ratchet.
export const sharedCoverage = {
  provider: 'v8' as const,
  reportsDirectory: fromRoot('./coverage'),
  reporter: ['text-summary', 'html', 'json-summary'] as string[],
  include: ['packages/*/src/**', 'apps/web/{app,lib,components}/**'],
  exclude: [
    '**/*.test.ts',
    '**/*.test.tsx',
    '**/__tests__/**',
    '**/*.disabled',
    '**/drizzle/**',
    '**/*.d.ts',
    '**/node_modules/**',
  ],
  thresholds: {
    statements: 20,
    branches: 19,
    functions: 21,
    lines: 20,
  },
}
