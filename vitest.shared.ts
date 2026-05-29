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
export const sharedTest = {
  environment: 'node' as const,
  globals: false,
  pool: 'forks' as const,
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
