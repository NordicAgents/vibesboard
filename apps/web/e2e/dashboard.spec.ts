// Authenticated dashboard tests.
//
// Reuses the cookie jar saved by global-setup so we land directly on the authed
// pages without re-driving the sign-in form.
import { test, expect } from '@playwright/test'
import { STORAGE_STATE } from './constants.ts'

test.use({ storageState: STORAGE_STATE })

test('/agents loads and shows the Create Agent affordance', async ({
  page
}) => {
  await page.goto('/agents')
  // Should NOT be redirected to sign-in.
  await expect(page).toHaveURL(/\/agents/, { timeout: 15_000 })

  // Target the "Create Agent" affordance by accessible name: the sidebar also
  // links to /agents/create-chat (labelled "New Agent"), and the page renders
  // "Create Agent" in two spots (header + empty-state CTA), so match by name
  // and take the first to avoid strict-mode on the duplicate.
  const createLink = page.getByRole('link', { name: 'Create Agent' }).first()
  await expect(createLink).toBeVisible()
})

test('/settings loads without redirecting to sign-in', async ({ page }) => {
  await page.goto('/settings')
  // The key assertion: an authenticated user is NOT bounced to /sign-in.
  await expect(page).not.toHaveURL(/\/sign-in/, { timeout: 15_000 })
  await expect(page.locator('body')).toBeVisible()
})
