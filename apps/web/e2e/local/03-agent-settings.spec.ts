/**
 * Section 3 — Agent Settings / Setup tab
 *
 * `/agents/[id]?tab=configure` is the legacy alias that AgentDashboardTabs
 * resolves to the "setup" tab (agent-dashboard-tabs.tsx:52-59), which renders
 * AgentSetupTab plus the sticky "Save Changes" bar. Saving goes through
 * useAgentForm.handleSaveAll → PATCH /api/agents/[id].
 *
 * Covers:
 *   - ?tab=configure selects Setup and pre-fills name + instructions from the DB
 *   - Save Changes is gated on hasChanges (no phantom-dirty state on load)
 *   - Renaming persists: PATCH 200 → success toast → API read-back → reload →
 *     the /agents list card
 *   - Updating instructions persists (read-back + reload)
 *   - GET /api/agents/[id] returns the owner's full record (exact field values)
 *   - An invalid name is refused and never persisted (API + UI)
 *   - Deleting from the Share tab: confirm dialog → 204 → redirect → 404
 *   - DELETE /api/agents/[id] is 204 and the row is really gone
 *
 * Deliberately NOT covered here: cross-tenant reads/writes of an agent — that
 * is 12-tenant-isolation.spec.ts, which drives the same routes as the outsider.
 *
 * Selector note: the Setup tab's name Input and instructions Textarea carry no
 * `name` attribute and no data-testid (components/ui/input.tsx and
 * components/ui/textarea.tsx only spread props), so the only stable hooks the
 * app renders today are their exact placeholders. Both are matched in strict
 * mode (no `.first()`) so a second matching control would fail the test rather
 * than be silently skipped.
 */
import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from '@playwright/test'
import { BASE_URL, STORAGE_STATE } from '../constants.ts'

test.use({ storageState: STORAGE_STATE })

// agent-setup-tab.tsx:109 and :181 — verified against the app source.
const NAME_PLACEHOLDER = 'Agent name'
const INSTRUCTIONS_PLACEHOLDER =
  'Explain how the agent should behave, tone, and guardrails.'

interface CreatedAgent {
  id: string
  name: string
  instructions: string
  agentUrl: string
  tenantSlug: string
}

/** Every agent this file creates, so afterAll can remove them all. */
const createdIds: string[] = []

/**
 * Create a throwaway agent for a single test. The tenant is derived server-side
 * from getActiveTenant(user.id) (app/api/agents/route.ts:151) — upsertAgentSchema
 * has no tenantId key, so sending one is dead weight and is not sent here.
 * `instructions` must be >= 10 chars (packages/agents/src/schema.ts:176).
 */
async function createAgent(
  api: APIRequestContext,
  label: string,
): Promise<CreatedAgent> {
  const name = `E2E ${label} ${Date.now()}-${Math.floor(Math.random() * 10_000)}`
  const instructions = `Original instructions for the ${label} test.`

  const res = await api.post('/api/agents', {
    data: { name, instructions },
    failOnStatusCode: false,
  })
  const raw = await res.text()
  expect(res.status(), `POST /api/agents failed: ${raw}`).toBe(200)

  const { agent } = JSON.parse(raw)
  expect(agent?.id, 'POST /api/agents must return the created agent').toBeTruthy()
  createdIds.push(agent.id)

  return {
    id: agent.id,
    name,
    instructions,
    agentUrl: agent.agentUrl,
    tenantSlug: agent.tenantSlug,
  }
}

/** Read an agent back through the API, asserting the read itself succeeded. */
async function readAgent(api: APIRequestContext, id: string) {
  const res = await api.get(`/api/agents/${id}`, { failOnStatusCode: false })
  expect(res.status(), `GET /api/agents/${id} failed: ${res.status()}`).toBe(200)
  const { agent } = await res.json()
  expect(agent?.id).toBe(id)
  return agent
}

test.afterAll(async () => {
  const api = await playwrightRequest.newContext({
    baseURL: BASE_URL,
    storageState: STORAGE_STATE,
  })
  try {
    for (const id of createdIds) {
      await api.delete(`/api/agents/${id}`, { failOnStatusCode: false })
    }
  } finally {
    await api.dispose()
  }
})

test.describe('Agent Settings — Setup tab', () => {
  test('?tab=configure selects Setup and pre-fills name and instructions', async ({
    page,
    request,
  }) => {
    const agent = await createAgent(request, 'Prefill')

    await page.goto(`/agents/${agent.id}?tab=configure`)
    await expect(page).not.toHaveURL(/sign-in/)

    // The legacy `configure` alias must resolve to the Setup tab.
    await expect(page.getByRole('tab', { name: /^setup$/i })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    // Values come from the DB row we just created, not from the layout.
    await expect(
      page.getByPlaceholder(NAME_PLACEHOLDER, { exact: true }),
    ).toHaveValue(agent.name)
    await expect(
      page.getByPlaceholder(INSTRUCTIONS_PLACEHOLDER, { exact: true }),
    ).toHaveValue(agent.instructions)

    // agent-setup-tab.tsx:112-114 renders the public path — only this tab does.
    await expect(
      page.getByText(`/${agent.tenantSlug}/${agent.agentUrl}`, { exact: true }),
    ).toBeVisible()
  })

  test('Save Changes is disabled until a field actually changes', async ({
    page,
    request,
  }) => {
    const agent = await createAgent(request, 'Dirty Gate')

    await page.goto(`/agents/${agent.id}?tab=configure`)
    const nameInput = page.getByPlaceholder(NAME_PLACEHOLDER, { exact: true })
    await expect(nameInput).toHaveValue(agent.name)

    const saveBtn = page.getByRole('button', { name: /save changes/i })
    // useAgentForm.hasChanges must be false for a freshly loaded agent — a
    // regression that makes the form dirty on mount (e.g. a default that does
    // not round-trip) would arm the save bar with no user edit.
    await expect(saveBtn).toBeDisabled()

    await nameInput.fill(`${agent.name} edited`)
    await expect(saveBtn).toBeEnabled()
  })

  test('renaming persists to the API, survives a reload and updates the agents list', async ({
    page,
    request,
  }) => {
    const agent = await createAgent(request, 'Rename')
    const newName = `E2E Renamed ${Date.now()}`

    await page.goto(`/agents/${agent.id}?tab=configure`)
    const nameInput = page.getByPlaceholder(NAME_PLACEHOLDER, { exact: true })
    await expect(nameInput).toHaveValue(agent.name)
    await nameInput.fill(newName)

    const saveBtn = page.getByRole('button', { name: /save changes/i })
    await expect(saveBtn).toBeEnabled()

    const [patchRes] = await Promise.all([
      page.waitForResponse(
        r =>
          r.url().includes(`/api/agents/${agent.id}`) &&
          r.request().method() === 'PATCH',
      ),
      saveBtn.click(),
    ])
    expect(patchRes.status()).toBe(200)

    // AppToaster stamps role="status" on every non-error toast, so the role
    // alone does not say which one this is — assert the success copy from
    // use-agent-form.ts.
    await expect(page.getByText('Changes saved')).toBeVisible()

    // Persistence, not "no error toast": read the row back.
    const saved = await readAgent(page.request, agent.id)
    expect(saved.name).toBe(newName)
    expect(saved.instructions).toBe(agent.instructions)

    // ...and the form re-hydrates from the DB on a hard reload.
    await page.reload()
    await expect(
      page.getByPlaceholder(NAME_PLACEHOLDER, { exact: true }),
    ).toHaveValue(newName)

    // The list page reads /api/agents; the renamed agent is the newest row in
    // the tenant, so it is on page 1 of the 9-per-page grid.
    await page.goto('/agents')
    // The renamed agent appears twice by design — once as a grid card and once
    // in the sidebar list — so this must not be a strict single-element match.
    await expect(page.getByText(newName, { exact: true }).first()).toBeVisible()
    // The old name must be gone from *both* places.
    await expect(page.getByText(agent.name, { exact: true })).toHaveCount(0)
  })

  test('updating instructions persists to the API and survives a reload', async ({
    page,
    request,
  }) => {
    const agent = await createAgent(request, 'Instructions')
    const newInstructions = `Updated E2E instructions ${Date.now()}: be concise and helpful.`

    await page.goto(`/agents/${agent.id}?tab=configure`)
    const instructionsField = page.getByPlaceholder(INSTRUCTIONS_PLACEHOLDER, {
      exact: true,
    })
    await expect(instructionsField).toHaveValue(agent.instructions)
    await instructionsField.fill(newInstructions)

    const saveBtn = page.getByRole('button', { name: /save changes/i })
    await expect(saveBtn).toBeEnabled()

    const [patchRes] = await Promise.all([
      page.waitForResponse(
        r =>
          r.url().includes(`/api/agents/${agent.id}`) &&
          r.request().method() === 'PATCH',
      ),
      saveBtn.click(),
    ])
    expect(patchRes.status()).toBe(200)
    await expect(page.getByText('Changes saved')).toBeVisible()

    const saved = await readAgent(page.request, agent.id)
    expect(saved.instructions).toBe(newInstructions)
    expect(saved.name).toBe(agent.name)

    await page.reload()
    await expect(
      page.getByPlaceholder(INSTRUCTIONS_PLACEHOLDER, { exact: true }),
    ).toHaveValue(newInstructions)
  })

  test('GET /api/agents/[id] returns the owner’s full record', async ({
    request,
  }) => {
    const agent = await createAgent(request, 'Read')

    const res = await request.get(`/api/agents/${agent.id}`, {
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(200)
    const { agent: body } = await res.json()

    expect(body.id).toBe(agent.id)
    expect(body.name).toBe(agent.name)
    expect(body.instructions).toBe(agent.instructions)
    expect(body.agentUrl).toBe(agent.agentUrl)
    expect(body.tenantSlug).toBe(agent.tenantSlug)
    // Slug is derived from the name by slugify() (packages/utils/src/general.ts:14).
    expect(body.agentUrl).toMatch(/^e2e-read-\d+/)
    // Schema defaults applied at insert time (packages/agents/src/schema.ts:174-205).
    expect(body.mode).toBe('provider')
    expect(body.allowAnonymous).toBe(true)
    expect(body.quickSuggestionsMode).toBe('smart')
    expect(body.quickSuggestionsCount).toBe(4)
    expect(body.llmConfigId).toBeNull()
    expect(body.handoffTargets).toEqual([])
    expect(body.tenantId).toBeTruthy()
  })
})

test.describe('Agent Settings — invalid input', () => {
  // packages/agents/src/schema.ts:175 — name is z.string().min(2).max(120), and
  // patchAgentSchema is upsertAgentSchema.partial() (:207).
  const INVALID_NAMES = ['', 'a', 'x'.repeat(121)]

  test('PATCH refuses a schema-invalid name and leaves the row untouched', async ({
    request,
  }) => {
    const agent = await createAgent(request, 'Invalid Name')

    for (const badName of INVALID_NAMES) {
      const res = await request.patch(`/api/agents/${agent.id}`, {
        data: { name: badName },
        failOnStatusCode: false,
      })

      // PATCH now safeParses like POST /api/agents, so schema-invalid input is
      // a 400 rather than an escaping ZodError surfacing as 500.
      expect(
        res.status(),
        `PATCH with name=${JSON.stringify(badName)} must be rejected`,
      ).toBe(400)
    }

    // The important invariant, independent of the status code: nothing landed.
    const after = await readAgent(request, agent.id)
    expect(after.name).toBe(agent.name)
    expect(after.instructions).toBe(agent.instructions)
  })

  test('clearing the name in the Setup form does not persist an empty name', async ({
    page,
    request,
  }) => {
    const agent = await createAgent(request, 'Empty Name UI')

    await page.goto(`/agents/${agent.id}?tab=configure`)
    const nameInput = page.getByPlaceholder(NAME_PLACEHOLDER, { exact: true })
    await expect(nameInput).toHaveValue(agent.name)
    await nameInput.clear()

    const saveBtn = page.getByRole('button', { name: /save changes/i })
    await expect(saveBtn).toBeEnabled()

    const [patchRes] = await Promise.all([
      page.waitForResponse(
        r =>
          r.url().includes(`/api/agents/${agent.id}`) &&
          r.request().method() === 'PATCH',
      ),
      saveBtn.click(),
    ])
    // Refused as a 400 (schema-invalid), not a 500.
    expect(patchRes.status()).toBe(400)

    // An error toast appears (use-agent-form.ts renders toast.error on failure).
    // AppToaster gives error toasts role="alert" and every other toast
    // role="status", so the role is what separates the two here.
    await expect(page.getByRole('alert').first()).toBeVisible()
    // ...and the success copy must be absent.
    await expect(page.getByText('Changes saved')).toHaveCount(0)

    const after = await readAgent(page.request, agent.id)
    expect(after.name).toBe(agent.name)
  })
})

test.describe('Agent Settings — deletion', () => {
  test('the Share tab delete flow confirms, redirects and removes the agent', async ({
    page,
    request,
  }) => {
    const agent = await createAgent(request, 'Delete UI')

    await page.goto(`/agents/${agent.id}?tab=share`)
    await expect(page.getByRole('tab', { name: /^share$/i })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    // agent-share-tab.tsx:87-92 — only the Share tab renders the danger zone.
    await expect(page.getByText('Danger Zone')).toBeVisible()

    // Only the AlertDialogTrigger exists at this point; the confirm button with
    // the same label is mounted by the portal once the dialog opens.
    await page.getByRole('button', { name: 'Delete Agent' }).click()

    const dialog = page.getByRole('alertdialog')
    await expect(
      dialog.getByText('Are you absolutely sure?'),
    ).toBeVisible()
    // The dialog must name the agent it is about to destroy.
    await expect(dialog).toContainText(agent.name)

    const [delRes] = await Promise.all([
      page.waitForResponse(
        r =>
          r.url().includes(`/api/agents/${agent.id}`) &&
          r.request().method() === 'DELETE',
      ),
      dialog.getByRole('button', { name: 'Delete Agent' }).click(),
    ])
    expect(delRes.status()).toBe(204)

    await expect(page.getByText('Agent deleted')).toBeVisible()

    // use-agent-form.ts:227 pushes '/', which redirects on to /agents or
    // /agents/create-chat depending on how many agents remain — assert only
    // that we left the (now deleted) agent's page.
    await page.waitForURL(url => !url.pathname.includes(agent.id), {
      timeout: 30_000,
    })

    const gone = await page.request.get(`/api/agents/${agent.id}`, {
      failOnStatusCode: false,
    })
    expect(gone.status()).toBe(404)
  })

  test('DELETE /api/agents/[id] returns 204 and the agent is gone', async ({
    request,
  }) => {
    const agent = await createAgent(request, 'Delete API')

    const delRes = await request.delete(`/api/agents/${agent.id}`, {
      failOnStatusCode: false,
    })
    // app/api/agents/[id]/route.ts:240 — the handler can only ever return 204.
    expect(delRes.status()).toBe(204)
    expect(await delRes.text()).toBe('')

    const getRes = await request.get(`/api/agents/${agent.id}`, {
      failOnStatusCode: false,
    })
    expect(getRes.status()).toBe(404)

    // A second delete is a 404, not a silent success.
    const again = await request.delete(`/api/agents/${agent.id}`, {
      failOnStatusCode: false,
    })
    expect(again.status()).toBe(404)
  })
})
