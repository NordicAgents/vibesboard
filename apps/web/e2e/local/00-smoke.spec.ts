/**
 * Section 0 — Smoke Tests
 *
 * Fast baseline checks — all unauthenticated.
 * If these fail, nothing else will work.
 *
 * Covers:
 *   - Health API returns ok
 *   - Landing page loads
 *   - Sign-in page loads
 *   - Mock OpenAI server is reachable
 *   - APP_PORT config guard
 */
import { test, expect } from '@playwright/test'
import { BASE_URL, MOCK_OPENAI_PORT } from '../constants.ts'

// All smoke tests run unauthenticated
test.use({ storageState: { cookies: [], origins: [] } })

test('GET /api/health returns { ok: true }', async ({ request }) => {
  const res = await request.get('/api/health')
  expect(res.ok()).toBeTruthy()
  const body = await res.json()
  expect(body.ok).toBe(true)
})

test('landing page loads (HTTP < 400)', async ({ page }) => {
  const res = await page.goto('/')
  expect(res?.status()).toBeLessThan(400)
  await expect(page.locator('body')).toBeVisible()
})

test('sign-in page shows email + password inputs', async ({ page }) => {
  await page.goto('/sign-in')
  await expect(page.locator('input[type="email"], input[name="email"]')).toBeVisible()
  await expect(page.locator('input[type="password"], input[name="password"]')).toBeVisible()
})

test('sign-up page loads', async ({ page }) => {
  await page.goto('/sign-up')
  await expect(page.locator('body')).toBeVisible()
  await expect(page.locator('input[type="email"], input[name="email"]')).toBeVisible()
})

test('forgot-password page loads', async ({ page }) => {
  await page.goto('/forgot-password')
  await expect(page.locator('body')).toBeVisible()
  await expect(page.getByRole('button', { name: /send reset link/i })).toBeVisible()
})

test('mock OpenAI server is reachable at /healthz', async ({ request }) => {
  const res = await request.get(`http://localhost:${MOCK_OPENAI_PORT}/healthz`)
  expect(res.ok()).toBeTruthy()
})

test('the suite is pointed at the local test server, not the manual dev server', async ({}) => {
  expect(new URL(BASE_URL).port).toBe(process.env.E2E_APP_PORT ?? '3100')
})
