// Smoke tests (UNAUTHENTICATED).
//
// Verifies the harness is wired up end-to-end: the Next app serves the landing
// page and sign-in form, a health endpoint reports OK, and the deterministic
// mock OpenAI server is reachable (proving the model stub is up before the
// chat test relies on it).
import { test, expect } from '@playwright/test'
import { BASE_URL, MOCK_OPENAI_PORT } from './constants.ts'

// These specs must not use the saved authenticated cookie jar.
test.use({ storageState: { cookies: [], origins: [] } })

test('landing page loads with a visible body', async ({ page }) => {
  const res = await page.goto('/')
  expect(res, 'navigation response').not.toBeNull()
  // Next can serve / as 200; some setups redirect to a marketing/sign-in route.
  expect(res!.status(), 'landing HTTP status').toBeLessThan(400)
  await expect(page.locator('body')).toBeVisible()
})

test('sign-in page shows email and password inputs', async ({ page }) => {
  await page.goto('/sign-in')
  await expect(page.locator('input[name="email"]')).toBeVisible()
  await expect(page.locator('input[name="password"]')).toBeVisible()
})

test('a health endpoint returns ok', async ({ request }) => {
  const res = await request.get('/api/health')
  expect(res.ok(), `GET /api/health -> ${res.status()}`).toBeTruthy()
})

test('mock OpenAI server is reachable', async ({ request }) => {
  const res = await request.get(`http://localhost:${MOCK_OPENAI_PORT}/healthz`)
  expect(
    res.ok(),
    `GET mock /healthz -> ${res.status()}`,
  ).toBeTruthy()
})

test('base url is the configured app port', async () => {
  // Guards against accidental config drift between constants and a running app.
  expect(BASE_URL).toContain(':3100')
})
