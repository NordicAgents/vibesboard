// Public widget smoke (UNAUTHENTICATED).
//
// The embeddable widget lives at /widget/[agentId] (app/widget/[agentId]/page.tsx):
//   - getAgentById(agentId) -> notFound() (404) if the agent doesn't exist
//   - if agent.allowAnonymous: renders <PublicAgentExperience embed> (200)
//   - else: renders <GatedWidgetPage> (an access-code gate) — still a 200 page
// So any resolvable agent id yields a 200 widget page. We provision one in a
// beforeAll using the AUTHENTICATED API (find-or-create an anonymous agent),
// then visit the widget UNAUTHENTICATED. If we cannot obtain an agent id, the
// test skips with a clear reason rather than failing.
import { test, expect, request as pwRequest } from '@playwright/test'
import { BASE_URL, STORAGE_STATE } from './constants.ts'

// This spec runs logged-out (the widget is a public surface).
test.use({ storageState: { cookies: [], origins: [] } })

let agentId: string | null = null

test.beforeAll(async () => {
  // Use a SEPARATE authenticated context only to provision the agent; the test
  // itself uses the default (logged-out) context from test.use above.
  const authed = await pwRequest.newContext({
    baseURL: BASE_URL,
    storageState: STORAGE_STATE,
  })
  try {
    // Find the active tenant so the list query is correctly scoped.
    let tenantId: string | null = null
    const tenantRes = await authed.get('/api/user/active-tenant')
    if (tenantRes.ok()) {
      const body = await tenantRes.json().catch(() => null)
      tenantId = body?.tenant_id ?? body?.tenantId ?? null
    }
    const listUrl = tenantId
      ? `/api/agents?tenant_id=${encodeURIComponent(tenantId)}`
      : '/api/agents'

    // Prefer an existing agent (any resolvable id renders a 200 widget page).
    const listRes = await authed.get(listUrl)
    if (listRes.ok()) {
      const body = await listRes.json().catch(() => null)
      const arr = Array.isArray(body) ? body : body?.agents ?? body?.data
      if (Array.isArray(arr) && arr.length > 0 && arr[0]?.id) {
        agentId = String(arr[0].id)
      }
    }

    // Otherwise create an anonymous-enabled agent so the widget renders the
    // public experience directly (no access gate).
    if (!agentId) {
      const createRes = await authed.post('/api/agents', {
        data: {
          name: 'E2E Public Widget Agent',
          instructions: 'Public E2E widget agent.',
          allowAnonymous: true,
        },
        failOnStatusCode: false,
      })
      if (createRes.ok()) {
        const body = await createRes.json().catch(() => null)
        agentId = String(body?.agent?.id ?? body?.id ?? '') || null
      }
    }
  } finally {
    await authed.dispose()
  }
})

test('widget route renders for a public agent', async ({ page }) => {
  test.skip(
    !agentId,
    'Could not find or create an agent via the authenticated API; no agent id to render the widget.',
  )

  const res = await page.goto(`/widget/${agentId}`)
  expect(res, 'navigation response').not.toBeNull()
  // A resolvable agent yields a 200 widget shell (public experience OR gate).
  expect(res!.status(), `GET /widget/${agentId} status`).toBeLessThan(400)
  await expect(page.locator('body')).toBeVisible()
})
