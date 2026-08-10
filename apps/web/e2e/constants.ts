// Shared constants for the Playwright E2E suite.
export const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3100)
export const BASE_URL = `http://localhost:${APP_PORT}`
export const MOCK_OPENAI_PORT = Number(process.env.MOCK_OPENAI_PORT ?? 4010)

// Deterministic E2E account, created in global-setup via the sign-up endpoint
// (which also auto-provisions a personal tenant via the on-user-create hook).
// A timestamp-free, stable email keeps re-runs idempotent.
export const E2E_USER = {
  email: 'e2e-tester@vibesboard.local',
  password: 'E2e-Test-Pass-123!',
  name: 'E2E Tester',
}

// A second, unrelated account used to prove tenant isolation: it is a member of
// no tenant the E2E_USER owns, so every cross-tenant request it makes must be
// refused. Seeded by e2e/local/global-setup.ts.
export const E2E_OUTSIDER = {
  email: 'e2e-outsider@vibesboard.local',
  password: 'E2e-Outsider-Pass-123!',
  name: 'E2E Outsider',
}

// Where Playwright saves the authenticated browser state (cookie jar).
export const STORAGE_STATE = 'e2e/.auth/user.json'
export const OUTSIDER_STATE = 'e2e/.auth/outsider.json'
