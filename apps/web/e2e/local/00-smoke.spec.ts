/**
 * Section 0 — Smoke Tests
 *
 * Fast baseline checks — all unauthenticated (the file-level storageState is
 * empty, so the saved cookie jar is never reused and the real sign-in form is
 * exercised in a genuinely logged-out browser).
 *
 * Covers:
 *   - Health API returns exactly { ok: true }
 *   - Landing page renders the hero (not just <body>)
 *   - Sign-in page renders the sign-in variant of LoginForm
 *   - Sign-in form: happy path (session cookie + server-verified session) and
 *     wrong password (401 + error toast + no session)
 *   - Sign-up page renders the sign-up variant, and submitting it reaches the
 *     "check your email" confirmation screen
 *   - Forgot-password page renders its own form
 *   - Mock OpenAI server answers with the deterministic stub contract
 *   - The browser fixture's baseURL matches e2e/constants.ts
 */
import { test, expect } from '@playwright/test'
import { BASE_URL, E2E_USER, MOCK_OPENAI_PORT } from '../constants.ts'

// All smoke tests run unauthenticated
test.use({ storageState: { cookies: [], origins: [] } })

// The canned reply produced by e2e/mock-openai.mjs.
const STUB_REPLY =
  'This is a deterministic E2E stubbed reply from the mock model.'

// better-auth's session cookie is `better-auth.session_token`, prefixed with
// `__Secure-` over HTTPS (see apps/web/middleware.ts).
const isSessionCookie = (name: string) =>
  name.endsWith('better-auth.session_token')

test('GET /api/health returns exactly { ok: true }', async ({ request }) => {
  const res = await request.get('/api/health')
  // app/api/health/route.ts returns NextResponse.json({ ok: true }) — one status,
  // one body shape.
  expect(res.status()).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
})

test('landing page renders the hero for a logged-out visitor', async ({
  page
}) => {
  const res = await page.goto('/')
  // app/page.tsx renders the marketing tree when there is no session (an
  // authenticated visitor is redirected to /agents instead).
  expect(res?.status()).toBe(200)
  // Copy owned by lib/landing-hero-copy.ts + components/landing/landing-hero.tsx
  // — rendered by this page only, never by the shared layout.
  await expect(
    page.getByRole('heading', {
      name: /the agent platform you host yourself/i,
      level: 1
    })
  ).toBeVisible()
  // The primary CTA sends visitors to the self-hosting quickstart rather than
  // to a signup wall — that is the point of the open-source landing page.
  await expect(
    page.getByRole('link', { name: 'Start self-hosting', exact: true })
  ).toHaveAttribute('href', '#quickstart')
  // Sign-in lives in the header, not in the hero.
  await expect(
    page.getByRole('link', { name: 'Sign in', exact: true }).first()
  ).toHaveAttribute('href', '/sign-in')
})

test('landing header carries only the wordmark, the repo and a sign-in', async ({
  page
}) => {
  await page.goto('/')
  // Located by element, not by `getByRole('banner')`: app/layout.tsx wraps every
  // page in <main>, and a <header> nested inside main maps to the generic role
  // rather than to banner, so the role selector matches nothing here.
  const header = page.locator('header')

  // The old agency nav is gone: no Products dropdown, no Features/About anchors.
  await expect(header.getByText('Products')).toHaveCount(0)
  for (const label of ['Features', 'About', 'Docs', 'Quickstart']) {
    await expect(
      header.getByRole('link', { name: label, exact: true })
    ).toHaveCount(0)
  }

  // Two actions, both always visible — there is no hamburger to open.
  await expect(header.getByRole('link', { name: /GitHub/ })).toHaveAttribute(
    'href',
    'https://github.com/NordicAgents/vibeagent'
  )
  await expect(
    header.getByRole('link', { name: 'Sign in', exact: true })
  ).toBeVisible()
  await expect(header.getByRole('button')).toHaveCount(0)
})

test('sign-in page renders the sign-in variant of the auth form', async ({
  page
}) => {
  await page.goto('/sign-in')
  await expect(
    page.getByRole('heading', { name: 'Welcome back' })
  ).toBeVisible()
  await expect(page.locator('input[name="email"]')).toBeVisible()
  await expect(page.locator('input[name="password"]')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Sign In', exact: true })
  ).toBeVisible()
  // Sign-in-only affordance (components/login-form.tsx renders it when
  // action === 'sign-in').
  await expect(
    page.getByRole('link', { name: 'Forgot password?' })
  ).toBeVisible()
  // The Name field belongs to the sign-up variant only — its presence would
  // mean the wrong `action` prop was passed.
  await expect(page.locator('input[name="name"]')).toHaveCount(0)
})

test('signing in through the form gives the browser a real session', async ({
  page
}) => {
  // /agents is a first-hit compile under `next dev`.
  test.slow()

  await page.goto('/sign-in')
  await page.locator('input[name="email"]').fill(E2E_USER.email)
  await page.locator('input[name="password"]').fill(E2E_USER.password)

  const signInResponse = page.waitForResponse(
    r =>
      r.url().includes('/api/auth/sign-in/email') &&
      r.request().method() === 'POST'
  )
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  const res = await signInResponse
  // better-auth returns 200 for verified credentials (global-setup marks the
  // E2E user's email verified; requireEmailVerification is on).
  expect(res.status(), 'POST /api/auth/sign-in/email').toBe(200)

  // The submit handler's success path must leave the browser holding a session.
  const cookies = await page.context().cookies()
  expect(
    cookies.map(c => c.name).filter(isSessionCookie),
    'better-auth session cookie after form sign-in'
  ).not.toHaveLength(0)

  // And the server must accept that cookie: page.request shares the page's
  // cookie jar, so a 200 here proves a real, DB-backed session (401 otherwise).
  const active = await page.request.get('/api/user/active-tenant')
  expect(active.status(), 'GET /api/user/active-tenant').toBe(200)
  expect((await active.json()).tenant_id).toBeTruthy()

  // End-user outcome: the middleware no longer bounces a protected route.
  await page.goto('/agents')
  await expect(page).toHaveURL(/\/agents/)
  await expect(page).not.toHaveURL(/\/sign-in/)
})

test('signing in with a wrong password shows the error toast and grants no session', async ({
  page
}) => {
  await page.goto('/sign-in')
  await page.locator('input[name="email"]').fill(E2E_USER.email)
  await page
    .locator('input[name="password"]')
    .fill('definitely-not-the-password')

  const signInResponse = page.waitForResponse(
    r =>
      r.url().includes('/api/auth/sign-in/email') &&
      r.request().method() === 'POST'
  )
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  const res = await signInResponse
  // better-auth throws UNAUTHORIZED / INVALID_EMAIL_OR_PASSWORD on a password
  // mismatch.
  expect(res.status(), 'POST /api/auth/sign-in/email').toBe(401)

  // components/login-form.tsx surfaces error.message through react-hot-toast;
  // the message text comes from better-auth's BASE_ERROR_CODES.
  await expect(page.getByText('Invalid email or password')).toBeVisible()

  // Still on the form, and no session was issued.
  await expect(page).toHaveURL(/\/sign-in/)
  const cookies = await page.context().cookies()
  expect(
    cookies.map(c => c.name).filter(isSessionCookie),
    'no session cookie may be set after a failed sign-in'
  ).toHaveLength(0)
})

test('sign-up page renders the sign-up variant of the auth form', async ({
  page
}) => {
  await page.goto('/sign-up')
  await expect(
    page.getByRole('heading', { name: 'Create your account' })
  ).toBeVisible()
  // Name is rendered only when action === 'sign-up'.
  await expect(page.locator('input[name="name"]')).toBeVisible()
  await expect(page.locator('input[name="email"]')).toBeVisible()
  // The sign-up variant additionally constrains the password (minLength={8}).
  await expect(page.locator('input[name="password"]')).toHaveAttribute(
    'minlength',
    '8'
  )
  await expect(
    page.getByRole('button', { name: 'Create Account', exact: true })
  ).toBeVisible()
  // Sign-in-only affordances must be absent — this is what distinguishes the
  // two pages, which share one component.
  await expect(
    page.getByRole('link', { name: 'Forgot password?' })
  ).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Sign In', exact: true })
  ).toHaveCount(0)
})

test('submitting sign-up reaches the verification-notice screen without signing anyone in', async ({
  page
}) => {
  await page.goto('/sign-up')
  // Deliberately the existing E2E account: better-auth's enumeration protection
  // (requireEmailVerification is on) returns the same generic 200 as a fresh
  // sign-up and creates nothing, so this exercises the submit handler's success
  // branch without leaving a new user/tenant behind in the shared DB.
  await page.locator('input[name="name"]').fill(E2E_USER.name)
  await page.locator('input[name="email"]').fill(E2E_USER.email)
  await page.locator('input[name="password"]').fill(E2E_USER.password)

  const signUpResponse = page.waitForResponse(
    r =>
      r.url().includes('/api/auth/sign-up/email') &&
      r.request().method() === 'POST'
  )
  await page
    .getByRole('button', { name: 'Create Account', exact: true })
    .click()
  const res = await signUpResponse
  expect(res.status(), 'POST /api/auth/sign-up/email').toBe(200)

  // The needsVerify branch of components/login-form.tsx replaces the form with
  // the confirmation copy, echoing the address that was submitted.
  await expect(page.getByText('We sent a verification link to')).toBeVisible()
  await expect(page.getByText(E2E_USER.email)).toBeVisible()
  await expect(page.locator('input[name="password"]')).toHaveCount(0)

  // Sign-up must not auto-authenticate while verification is required.
  const cookies = await page.context().cookies()
  expect(
    cookies.map(c => c.name).filter(isSessionCookie),
    'sign-up must not issue a session before verification'
  ).toHaveLength(0)
})

test('forgot-password page renders its own reset form', async ({ page }) => {
  await page.goto('/forgot-password')
  await expect(
    page.getByRole('heading', { name: 'Reset your password' })
  ).toBeVisible()
  await expect(page.locator('input[name="email"]')).toBeVisible()
  await expect(
    page.getByRole('button', { name: /send reset link/i })
  ).toBeVisible()
  // This page renders ForgotPasswordForm, which has no password field —
  // regressing it to LoginForm would add one.
  await expect(page.locator('input[name="password"]')).toHaveCount(0)
})

test('mock OpenAI server serves the deterministic stub contract', async ({
  request
}) => {
  // Liveness alone is already guaranteed by Playwright's webServer gate on
  // /healthz, so assert the *contract* every model-dependent spec relies on:
  // the canned completion text and the fixed-width embedding.
  const chat = await request.post(
    `http://localhost:${MOCK_OPENAI_PORT}/v1/chat/completions`,
    { data: { model: 'gpt-4o', messages: [{ role: 'user', content: 'ping' }] } }
  )
  expect(chat.status()).toBe(200)
  const chatBody = await chat.json()
  expect(chatBody.choices?.[0]?.message?.content).toBe(STUB_REPLY)

  const embeddings = await request.post(
    `http://localhost:${MOCK_OPENAI_PORT}/v1/embeddings`,
    { data: { model: 'text-embedding-3-small', input: 'ping' } }
  )
  expect(embeddings.status()).toBe(200)
  const embeddingsBody = await embeddings.json()
  // 1536 dims — the width the pgvector columns are declared with.
  expect(embeddingsBody.data?.[0]?.embedding).toHaveLength(1536)
})

test('the app under test is bound to the mock model, not a real provider', async ({
  request
}) => {
  // The assertion that actually protects this suite. Everything else here
  // could pass against a hand-started dev server holding a REAL OPENAI_BASE_URL
  // and API key — reuseExistingServer adopts whatever is on :3100 — and the
  // bill would be the only signal.
  //
  // /api/smoke is the one unauthenticated route that invokes the model, so a
  // 200 carrying the mock's canned sentence proves the *server process*, not
  // the test runner, reached e2e/mock-openai.mjs.
  const res = await request.get('/api/smoke?mode=file')
  expect(res.status(), await res.text()).toBe(200)
  expect(await res.text()).toContain(STUB_REPLY)
})

test('the browser fixture and e2e/constants.ts agree on the app origin', async ({
  baseURL,
  page
}) => {
  // playwright.local.config.ts now imports APP_PORT/BASE_URL from
  // e2e/constants.ts, so this is a structural guarantee rather than a real
  // risk; it stays as a cheap guard against someone re-introducing a local
  // copy of the port. The navigation check below is the part with teeth.
  expect(baseURL).toBe(BASE_URL)

  // And relative navigation really resolves against it.
  await page.goto('/sign-in')
  expect(new URL(page.url()).origin).toBe(BASE_URL)
})
