/**
 * Local E2E configuration.
 *
 * Uses port 3100 for the test server (separate from the manual dev server on
 * 3001) and the mock OpenAI server on 4010 for deterministic, free responses.
 *
 * Postgres and S3 are env-driven: DATABASE_URL / DATABASE_MIGRATE_URL /
 * S3_ENDPOINT override the defaults below, so this runs against either the
 * docker-compose stack (Postgres on 5434) or a native install. See
 * docs/local-e2e.md.
 *
 * Run: bun run test:e2e:local
 */
import { defineConfig, devices } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  APP_PORT,
  BASE_URL,
  MOCK_OPENAI_PORT as MOCK_PORT,
  STORAGE_STATE,
} from './e2e/constants.ts'

// APP_PORT / BASE_URL / MOCK_PORT come from e2e/constants.ts rather than being
// re-declared here. They used to be duplicated, so this config and the specs
// could disagree about which port the suite targets — and 00-smoke's "pointed
// at the local test server" guard compared constants.ts to itself, making it
// true by construction and blind to exactly that drift.

// Postgres location. Defaults to 5434 (the docker-compose stack brought up with
// POSTGRES_HOST_PORT=5434), but both URLs are overridable so the suite can also
// run against a native Postgres — e.g. a Homebrew cluster on the default 5432.
// See docs/local-e2e.md.
const DB_URL =
  process.env.DATABASE_URL ??
  'postgres://vibesboard_app:vibesboard_app@localhost:5434/vibesboard_dev'
const DB_MIGRATE_URL =
  process.env.DATABASE_MIGRATE_URL ??
  'postgres://vibesboard_migrate:vibesboard_migrate@localhost:5434/vibesboard_dev'

// S3-compatible object storage (MinIO in docker, or a native `minio server`).
// 127.0.0.1 rather than localhost: Node resolves localhost to IPv6 first and
// MinIO publishes on IPv4 only.
const S3_ENDPOINT = process.env.S3_ENDPOINT ?? 'http://127.0.0.1:9000'

// Secrets are read from the environment, falling back to the developer's
// (gitignored) apps/web/.env.local so the test server signs with the same keys
// as any existing local DB data. Never inline the values here — .env.local
// holds real credentials and ENCRYPTION_KEY wraps tenant LLM API keys at rest.
const ENV_LOCAL_PATH = path.join(__dirname, '.env.local')

function readEnvLocal(): Record<string, string> {
  if (!existsSync(ENV_LOCAL_PATH)) return {}
  const out: Record<string, string> = {}
  for (const line of readFileSync(ENV_LOCAL_PATH, 'utf8').split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    out[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2')
  }
  return out
}

const envLocal = readEnvLocal()

/** Resolve a secret from process.env, then .env.local. Fails loudly if unset. */
function requireSecret(name: string): string {
  const value = process.env[name] ?? envLocal[name]
  if (!value) {
    throw new Error(
      `[playwright.local] ${name} is not set. Export it, or add it to apps/web/.env.local, before running the local E2E suite.`,
    )
  }
  return value
}

const BETTER_AUTH_SECRET = requireSecret('BETTER_AUTH_SECRET')
const ENCRYPTION_KEY = requireSecret('ENCRYPTION_KEY')
const CRON_SECRET = requireSecret('CRON_SECRET')
const VERIFY_TOKEN = requireSecret('VERIFY_TOKEN')
const ACCESS_GATE_SECRET = requireSecret('ACCESS_GATE_SECRET')

const appEnv: Record<string, string> = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: String(APP_PORT),
  NEXT_PUBLIC_APP_URL: BASE_URL,
  NEXT_PUBLIC_AUTH_GOOGLE: 'false',
  DATABASE_URL: DB_URL,
  DATABASE_MIGRATE_URL: DB_MIGRATE_URL,
  // Mock OpenAI — deterministic responses, no real API cost
  OPENAI_BASE_URL: `http://localhost:${MOCK_PORT}/v1`,
  OPENAI_API_KEY: 'sk-e2e-stub',
  OPENAI_MODEL: 'gpt-4o',
  // S3 / MinIO
  S3_ENDPOINT,
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'vibesboard-files',
  S3_ACCESS_KEY_ID: 'vibesboard',
  S3_SECRET_ACCESS_KEY: 'vibesboard',
  S3_FORCE_PATH_STYLE: 'true',
  // Secrets (must match the signing keys used when the DB was seeded)
  BETTER_AUTH_SECRET,
  BETTER_AUTH_URL: BASE_URL,
  ENCRYPTION_KEY,
  CRON_SECRET,
  VERIFY_TOKEN,
  ACCESS_GATE_SECRET,
}

export default defineConfig({
  // Only the local-machine suite; the CI specs live directly under e2e/.
  testDir: './e2e/local',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: false,
  retries: 1,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report-local', open: 'never' }],
  ],
  globalSetup: path.join(__dirname, 'e2e/local/global-setup.ts'),
  timeout: 90_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: [
    {
      command: 'node e2e/mock-openai.mjs',
      url: `http://localhost:${MOCK_PORT}/healthz`,
      // In CI nothing should already be listening; adopting a stray server
      // there would silently test the wrong process. Locally, reuse is what
      // lets a hand-started dev server be shared across runs.
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
      env: { MOCK_OPENAI_PORT: String(MOCK_PORT) },
    },
    {
      command: 'bun run --filter @vibesboard/web dev',
      url: BASE_URL,
      // In CI nothing should already be listening; adopting a stray server
      // there would silently test the wrong process. Locally, reuse is what
      // lets a hand-started dev server be shared across runs.
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      cwd: path.resolve(__dirname, '../../'),
      env: appEnv,
    },
  ],
})
