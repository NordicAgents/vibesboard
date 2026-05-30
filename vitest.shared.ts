// Shared Vitest configuration for the monorepo.
//
// Each package has its own `vitest.config.ts` that spreads `sharedTest` and
// `sharedResolveAlias` so per-package `vitest run` is scoped to that package,
// while the root `vitest.config.ts` aggregates every package via `projects`.
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

// Coverage config used at the repo root (reporting only, no hard gate yet).
export const sharedCoverage = {
  provider: 'v8' as const,
  reportsDirectory: fromRoot('./coverage'),
  reporter: ['text-summary', 'html', 'json-summary'] as string[],
  include: ['packages/*/src/**', 'apps/web/{app,lib,components}/**'],
  exclude: [
    '**/*.test.ts',
    '**/*.test.tsx',
    '**/__tests__/**',
    '**/drizzle/**',
    '**/*.d.ts',
    '**/node_modules/**',
  ],
}
