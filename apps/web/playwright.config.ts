// Playwright E2E configuration for the Vibesboard web app.
//
// Two webServers are booted: a deterministic mock OpenAI server and the Next
// app (via `next dev`) with OPENAI_BASE_URL pointed at the mock so the model is
// stubbed at the network boundary (server-side fetch can't be page.route()'d).
// global-setup seeds an E2E user + tenant and saves an authenticated cookie jar.
import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import {
  APP_PORT,
  BASE_URL,
  MOCK_OPENAI_PORT,
  STORAGE_STATE
} from './e2e/constants.ts'

const dbUrl =
  process.env.DATABASE_URL ??
  'postgres://vibesboard_app:vibesboard_app@localhost:5432/vibesboard_dev'
const dbMigrateUrl =
  process.env.DATABASE_MIGRATE_URL ??
  'postgres://vibesboard_migrate:vibesboard_migrate@localhost:5432/vibesboard_dev'

// Env shared by the Next dev server so it talks to local infra + the model mock.
const appEnv: Record<string, string> = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: String(APP_PORT),
  NEXT_PUBLIC_APP_URL: BASE_URL,
  DATABASE_URL: dbUrl,
  DATABASE_MIGRATE_URL: dbMigrateUrl,
  OPENAI_BASE_URL: `http://localhost:${MOCK_OPENAI_PORT}/v1`,
  OPENAI_API_KEY: 'sk-e2e-stub',
  // S3 / MinIO (file upload flows)
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
  S3_REGION: process.env.S3_REGION ?? 'us-east-1',
  S3_BUCKET: process.env.S3_BUCKET ?? 'vibesboard-files',
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'vibesboard',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'vibesboard',
  S3_FORCE_PATH_STYLE: 'true',
  // Minimal auth secret so better-auth boots in dev.
  BETTER_AUTH_SECRET:
    process.env.BETTER_AUTH_SECRET ?? 'e2e-better-auth-secret-0123456789',
  BETTER_AUTH_URL: BASE_URL
}

export default defineConfig({
  testDir: './e2e',
  // Only *.spec.ts are specs; helpers/setup/mock are plain modules.
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }]
  ],
  globalSetup: path.join(__dirname, 'e2e/global-setup.ts'),
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  webServer: [
    {
      command: 'node e2e/mock-openai.mjs',
      url: `http://localhost:${MOCK_OPENAI_PORT}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { MOCK_OPENAI_PORT: String(MOCK_OPENAI_PORT) }
    },
    {
      command: 'bun run --filter @vibesboard/web dev',
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      cwd: path.resolve(__dirname, '../../'),
      env: appEnv
    }
  ],
  // Authenticated specs opt in via test.use({ storageState: STORAGE_STATE }).
  metadata: { storageState: STORAGE_STATE }
})
