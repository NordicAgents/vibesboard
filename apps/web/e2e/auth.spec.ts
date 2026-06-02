// Authentication flow (UNAUTHENTICATED, fresh context).
//
// Uses an empty storageState so the saved authenticated cookie jar is NOT
// reused: we exercise the real redirect-when-logged-out behaviour and the real
// sign-in form.
import { test, expect } from '@playwright/test'
import { E2E_USER } from './constants.ts'

// Force a logged-out browser context for every test in this file.
test.use({ storageState: { cookies: [], origins: [] } })

test('visiting /agents while logged out redirects to /sign-in', async ({
  page
}) => {
  await page.goto('/agents')
  // middleware bounces unauthenticated users to the sign-in page.
  await page.waitForURL(/\/sign-in/, { timeout: 15_000 })
  expect(page.url()).toContain('/sign-in')
  await expect(page.locator('input[name="email"]')).toBeVisible()
})

test('signing in with valid creds authenticates and reaches the dashboard', async ({
  page
}) => {
  await page.goto('/sign-in')

  // The form inputs are controlled React state; fill works, but we wait for the
  // POST /api/auth/sign-in/email to return 200 to confirm the credentials were
  // accepted (rather than depending solely on a client-side redirect).
  await page.locator('input[name="email"]').fill(E2E_USER.email)
  await page.locator('input[name="password"]').fill(E2E_USER.password)

  const signInResponse = page.waitForResponse(
    r =>
      r.url().includes('/api/auth/sign-in/email') &&
      r.request().method() === 'POST',
    { timeout: 20_000 }
  )
  await page.locator('button:has-text("Sign In")').click()
  const res = await signInResponse
  expect(res.status(), 'sign-in API status').toBe(200)

  // The form calls router.push('/agents') after sign-in; in this environment
  // that client-side push does not always navigate (see productBugs). The
  // authoritative proof that login worked is: the session cookie is now set, so
  // an explicit navigation to a protected route is NOT bounced to /sign-in and
  // the dashboard affordance renders.
  await page.goto('/agents')
  await expect(page).toHaveURL(/\/agents/, { timeout: 15_000 })
  await expect(page).not.toHaveURL(/\/sign-in/)
  await expect(
    page.locator('a[href="/agents/create-chat"]').first()
  ).toBeVisible({ timeout: 15_000 })
})
