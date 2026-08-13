/**
 * Section 8 — Agent Sharing (share link, QR, canonical public URL, version history)
 *
 * What this file owns, and why the assertions look the way they do:
 *
 *   - The Share *panel* (agent-share-tab.tsx), never the Share *trigger*. Every
 *     TabsTrigger in agent-dashboard-tabs.tsx:140-153 renders unconditionally on
 *     every tab, so "the Share tab is visible" is equally true for ?tab=setup or
 *     even ?tab=zzz (isTabAvailable() returns true for unknown tabs). Radix
 *     unmounts inactive TabsContent, so only the panel's own nodes — the share
 *     URL text, the Copy button, the external link, the QR <img> — prove the
 *     Share tab actually rendered. The "scoped to the Share tab" test below is
 *     the negative control for exactly that.
 *   - The exact share URL. Both /api/agents/[id]/share (share/route.ts:36-48)
 *     and the agent page's server component (app/agents/[id]/page.tsx:82-94)
 *     independently build `${origin}/${tenantSlug}/${agentUrl}` from proxy
 *     headers, with an `'unknown'` tenant-slug fallback and a
 *     NEXT_PUBLIC_APP_URL/localhost:3000 origin fallback. Truthiness cannot
 *     tell any of those apart, so the URL is asserted verbatim on both sides
 *     (API body + rendered <a href>) and then actually fetched anonymously.
 *   - /[tenantSlug]/[agentSlug] — the canonical public page. No other spec in
 *     this suite visits it (05 covers /widget/[agentId]), so its assertions are
 *     specific: the composer's data-testid, and the *absence* of the access
 *     gate, whose password field is also an <input type="text"> and would
 *     otherwise satisfy a generic `textarea, input[type=text]` locator.
 *   - A freshly created agent has exactly one 'create' version snapshot,
 *     recorded transactionally with the insert (app/api/agents/route.ts:186-192).
 *     That makes the History tab deterministic: one row, labelled "Created",
 *     badged "Current", with no Restore button.
 *
 * Deliberately NOT covered here: the Share tab's Danger Zone / delete flow
 * (03-agent-settings.spec.ts), cross-tenant reads of /versions
 * (12-tenant-isolation.spec.ts), and restoring an older version
 * (09-agent-features.spec.ts).
 */
import { test, expect, request as playwrightRequest } from '@playwright/test'
import { BASE_URL, OUTSIDER_STATE, STORAGE_STATE } from '../constants.ts'

test.use({ storageState: STORAGE_STATE })

// Unique per run so re-runs never collide and no test depends on leftovers.
const RUN = Date.now()
const AGENT_NAME = `E2E Share Agent ${RUN}`
// upsertAgentSchema requires >= 10 characters.
const AGENT_INSTRUCTIONS = 'Shareable agent for the E2E share and QR suite.'
// Syntactically valid uuid that no row can own.
const MISSING_AGENT_ID = '00000000-0000-4000-8000-000000000000'

let agentId = ''
let tenantSlug = ''
let agentUrl = ''
/** The canonical public URL the API and the Share panel must both produce. */
let shareUrl = ''

test.beforeAll(async ({ request }) => {
  const tenantRes = await request.get('/api/user/active-tenant', {
    failOnStatusCode: false,
  })
  expect(tenantRes.status(), await tenantRes.text()).toBe(200)
  const { tenant_id: tenantId } = await tenantRes.json()
  expect(tenantId, 'the E2E user must have an active tenant').toBeTruthy()

  // POST /api/agents answers 200 { agent } (app/api/agents/route.ts:230). It
  // returns 400 with no active tenant and 500 if the insert/versioning
  // transaction fails — both used to leave agentId undefined and turn every
  // test below into a confusing "/api/agents/undefined/..." failure.
  const createRes = await request.post('/api/agents', {
    data: {
      name: AGENT_NAME,
      instructions: AGENT_INSTRUCTIONS,
      allowAnonymous: true,
    },
    failOnStatusCode: false,
  })
  expect(createRes.status(), `create agent: ${await createRes.text()}`).toBe(200)

  // The create response is already the mapped VibeAgent, so it carries both
  // halves of the canonical URL (mapAgentDoc — packages/agents/src/db.ts:103).
  // No /api/tenants/[id]/config round-trip, and nothing is left optional.
  const { agent } = await createRes.json()
  agentId = agent?.id ?? ''
  tenantSlug = agent?.tenantSlug ?? ''
  agentUrl = agent?.agentUrl ?? ''
  expect(agentId, 'create returned no agent.id').toBeTruthy()
  expect(tenantSlug, 'create returned no agent.tenantSlug').toBeTruthy()
  // 'unknown' is the fallback the create route uses when the tenant lookup
  // fails; it would silently produce a share URL that 404s.
  expect(tenantSlug).not.toBe('unknown')
  expect(agentUrl, 'create returned no agent.agentUrl').toBeTruthy()
  // The whole public-page test below depends on this flag having persisted.
  expect(agent.allowAnonymous).toBe(true)

  shareUrl = `${BASE_URL}/${tenantSlug}/${agentUrl}`
})

test.afterAll(async () => {
  if (!agentId) return
  const owner = await playwrightRequest.newContext({
    baseURL: BASE_URL,
    storageState: STORAGE_STATE,
  })
  try {
    // Best-effort cleanup — a cleanup hiccup must not mask a test result.
    await owner.delete(`/api/agents/${agentId}`, { failOnStatusCode: false })
  } finally {
    await owner.dispose()
  }
})

test.describe('Agent Share — API', () => {
  test('GET /share returns the canonical URL and a PNG QR payload', async ({
    request,
  }) => {
    const res = await request.get(`/api/agents/${agentId}/share`, {
      failOnStatusCode: false,
    })
    // share/route.ts:51 — exactly 200 for the owner. 404 would mean the fixture
    // vanished, 403 that canEditAgent regressed.
    expect(res.status()).toBe(200)

    const body = await res.json()
    // The one URL the route may produce for this agent and this Host header.
    expect(body.url).toBe(shareUrl)
    // getQrDataUrl → QRCode.toDataURL (lib/qr.ts:3-7) is a base64 PNG.
    expect(body.qrDataUrl).toMatch(/^data:image\/png;base64,/)
    // A 512px QR for a URL this long is several KB; this rules out an empty or
    // 1-pixel placeholder being handed back as "a QR".
    expect(body.qrDataUrl.length).toBeGreaterThan(1000)
  })

  test('the URL /share hands out is publicly reachable without a session', async () => {
    // A share link is worthless if it only resolves for the signed-in owner, or
    // if the origin points at another environment. Fetch it with a cookie-less
    // context and prove the public agent page came back.
    const anonymous = await playwrightRequest.newContext({ baseURL: BASE_URL, storageState: undefined })
    try {
      const res = await anonymous.get(shareUrl, { failOnStatusCode: false })
      expect(res.status()).toBe(200)
      // .url() is the URL after redirects — a bounce to /sign-in would show here.
      expect(res.url()).toBe(shareUrl)

      const html = await res.text()
      expect(html).toContain(AGENT_NAME)
      // access-gate-form.tsx:81 — the gate must not stand in front of an
      // allowAnonymous agent.
      expect(html).not.toContain('Enter a password or invite code to continue.')
    } finally {
      await anonymous.dispose()
    }
  })

  test('GET /share refuses a non-member with 403 and leaks no QR', async () => {
    // share/route.ts:32-34. 12-tenant-isolation.spec.ts covers /versions and
    // the agent read, but never /share — this route is otherwise untested.
    const outsider = await playwrightRequest.newContext({
      baseURL: BASE_URL,
      storageState: OUTSIDER_STATE,
    })
    try {
      const res = await outsider.get(`/api/agents/${agentId}/share`, {
        failOnStatusCode: false,
      })
      expect(res.status()).toBe(403)
      const text = await res.text()
      expect(text).not.toContain('data:image/png')
      expect(text).not.toContain(agentUrl)
    } finally {
      await outsider.dispose()
    }
  })

  test('GET /share for an unknown agent id is 404, not a 500', async ({
    request,
  }) => {
    // share/route.ts:22-24 — proves the 403 above is the permission check
    // talking rather than "agent not found" in disguise.
    const res = await request.get(`/api/agents/${MISSING_AGENT_ID}/share`, {
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(404)
  })

  test('versions API returns exactly the v1 "create" snapshot', async ({
    request,
  }) => {
    const res = await request.get(`/api/agents/${agentId}/versions`, {
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(200)

    const body = await res.json()
    // Every field asserted here is one the History tab renders
    // (agent-version-history-tab.tsx:106-131), so this pins the contract the
    // UI test below relies on instead of "it is an array".
    expect(body.currentVersion).toBe(1)
    expect(Array.isArray(body.versions)).toBe(true)
    expect(body.versions).toHaveLength(1)

    const [v1] = body.versions
    expect(v1.versionNo).toBe(1)
    // SOURCE_LABELS['create'] → the "Created" badge in the UI.
    expect(v1.source).toBe('create')
    expect(v1.isCurrent).toBe(true)
    expect(v1.restoredFrom).toBeNull()
    expect(v1.createdBy).toBeTruthy()
    expect(Number.isNaN(new Date(v1.createdAt).getTime())).toBe(false)
  })
})

test.describe('Agent Share — UI', () => {
  test('the Share tab renders the canonical link, Copy and the QR image', async ({
    page,
  }) => {
    const res = await page.goto(`/agents/${agentId}?tab=share`)
    expect(res?.status()).toBe(200)
    await expect(page).not.toHaveURL(/sign-in/)

    // Radix sets aria-selected on the active trigger (components/ui/tabs.tsx).
    // The tab list mounts after hydration flips the shell sidebar open, hence
    // the generous timeout on the first assertion.
    await expect(
      page.getByRole('tab', { name: /^share$/i })
    ).toHaveAttribute('aria-selected', 'true', { timeout: 20_000 })

    // agent-share-tab.tsx:60 — rendered only by the Share panel.
    await expect(page.getByText('Share Link', { exact: true })).toBeVisible()

    // agent-share-tab.tsx:67 — the URL printed to the user, byte for byte. The
    // page builds it independently of /api/agents/[id]/share, so asserting the
    // same value on both sides is what catches the two copies drifting apart.
    await expect(page.getByText(shareUrl, { exact: true })).toBeVisible()
    // agent-share-tab.tsx:72 — the "open in new tab" link points at it too.
    await expect(page.locator(`a[href="${shareUrl}"]`)).toHaveCount(1)
    // agent-share-tab.tsx:68-70.
    await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible()

    // qr-code.tsx:44-47. The "Generating QR..." placeholder at :33-41 has no
    // img role, so an empty/broken share payload cannot satisfy this.
    const qr = page.getByRole('img', { name: 'QR code' })
    await expect(qr).toBeVisible({ timeout: 20_000 })
    await expect(qr).toHaveAttribute('src', /^data:image\/png;base64,/)
    await expect(page.getByText('Generating QR...')).toHaveCount(0)
  })

  test('the Share panel is scoped to the Share tab, not the tab bar', async ({
    page,
  }) => {
    // Negative control for the test above: the Share *trigger* renders on every
    // tab, so an assertion on it proves nothing. The panel's own nodes must be
    // absent while another tab is selected (Radix unmounts inactive content).
    await page.goto(`/agents/${agentId}?tab=knowledge`)

    const shareTrigger = page.getByRole('tab', { name: /^share$/i })
    await expect(shareTrigger).toBeVisible({ timeout: 20_000 })
    await expect(shareTrigger).toHaveAttribute('aria-selected', 'false')

    await expect(page.getByText('Share Link', { exact: true })).toHaveCount(0)
    await expect(page.getByText(shareUrl, { exact: true })).toHaveCount(0)
    await expect(page.locator(`a[href="${shareUrl}"]`)).toHaveCount(0)
    await expect(page.getByRole('img', { name: 'QR code' })).toHaveCount(0)
  })

  test('the canonical public URL serves the anonymous chat, not the access gate', async ({
    page,
  }) => {
    // notFound() (app/[tenantSlug]/[agentSlug]/page.tsx:24,28) keeps the same
    // URL, so only the response status can catch a missing tenant or agent.
    const res = await page.goto(shareUrl)
    expect(res?.status()).toBe(200)
    await expect(page).toHaveURL(shareUrl)

    // public-agent-experience.tsx:224-226 — this agent's name, rendered only by
    // the public experience header.
    await expect(page.getByText(AGENT_NAME, { exact: true })).toBeVisible({
      timeout: 20_000,
    })
    // prompt-form.tsx:120 — the real composer. A generic
    // `textarea, input[type=text]` would also match the access gate's password
    // field (access-gate-form.tsx:85-93), i.e. the very regression this guards.
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 20_000 })
    await expect(
      page.getByPlaceholder('Password or invite code')
    ).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Continue' })).toHaveCount(0)
  })

  test('the History tab lists the v1 "Created" entry as current', async ({
    page,
  }) => {
    const res = await page.goto(`/agents/${agentId}?tab=history`)
    expect(res?.status()).toBe(200)
    await expect(page).not.toHaveURL(/sign-in/)

    await expect(
      page.getByRole('tab', { name: /^history$/i })
    ).toHaveAttribute('aria-selected', 'true', { timeout: 20_000 })

    // agent-version-history-tab.tsx:96 — the panel, not the trigger.
    await expect(page.getByText('Version History', { exact: true })).toBeVisible(
      { timeout: 20_000 }
    )

    // fetchVersions() swallows every failure into a toast and leaves the list
    // empty (lines 53-55), so the empty state is what a 500/403/regressed shape
    // looks like. A freshly created agent has exactly one 'create' version.
    await expect(page.getByText('No version history yet.')).toHaveCount(0)
    await expect(page.getByText('Created', { exact: true })).toHaveCount(1)
    await expect(page.getByText('Current', { exact: true })).toHaveCount(1)
    // Restore is rendered only for versions other than the current one
    // (line 134) — v1 is current, so there must be none.
    await expect(page.getByRole('button', { name: /^restore$/i })).toHaveCount(0)
  })
})
