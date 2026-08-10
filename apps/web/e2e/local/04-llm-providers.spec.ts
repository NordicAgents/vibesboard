/**
 * Section 4 — LLM Providers Settings (/settings/tenant/llm-providers)
 *
 * Covers, end to end and with a server-side read-back for every mutation:
 *   - the page's own chrome (header, Add Provider, Network Access card)
 *   - the add form: provider-kind options, per-kind model list, the recommended
 *     model that handleKindChange pre-selects
 *   - "Custom model ID…" reveals an empty free-text input that keeps what is typed
 *   - openai_compatible: free-text model field, Base URL field, embedding hints,
 *     Google Cloud AI Platform URL builder
 *   - create (predefined model AND custom base URL), edit + API-key preservation,
 *     Set default, Disable/Enable, delete
 *   - Network Access: the SSRF guard rejects private/link-local base URLs, and both
 *     opt-ins (host allowlist, allow-private-hosts switch) unblock them and persist
 *   - Task Routing: rows, assignment, persistence, clearing
 *   - Test connection: the route returns a sanitised error, never the raw one
 *
 * House rules used here:
 *   - every provider this file creates carries a unique `E2E LLM …` label and is
 *     deleted in afterEach, so no assertion can be satisfied by a leftover row —
 *     every provider row is addressed by its unique label, never by `.first()`;
 *   - tenant-level state this file mutates (network settings, the default
 *     provider) is snapshotted in beforeAll and restored in afterEach.
 */
import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test'
import { BASE_URL, STORAGE_STATE } from '../constants.ts'

test.use({ storageState: STORAGE_STATE })

const PAGE_PATH = '/settings/tenant/llm-providers'

/** Shared prefix so afterEach can find (and only find) what this file created. */
const PREFIX = 'E2E LLM'
const uniqueLabel = (name: string) => `${PREFIX} ${name} ${Date.now()}`

/**
 * A host in the RFC 2606 reserved `.invalid` TLD. It looks public, so the SSRF
 * guard lets it be saved, but it can never resolve — every outbound provider
 * call from the server therefore fails locally and deterministically instead of
 * reaching a third party. Used for all fixture providers so that even if one
 * briefly becomes the tenant default it cannot talk to the real network.
 */
const UNREACHABLE_BASE_URL = 'https://e2e-provider.invalid/v1'

/** The cloud metadata endpoint — the address the SSRF guard exists to block. */
const METADATA_HOST = '169.254.169.254'

interface Cfg {
  id: string
  label: string
  kind: string
  modelId: string
  baseUrl: string | null
  isEnabled: boolean
  isDefault: boolean
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function listProviders(api: APIRequestContext): Promise<Cfg[]> {
  const res = await api.get('/api/tenants/llm-configs')
  expect(res.status(), await res.text()).toBe(200)
  return ((await res.json()).configs ?? []) as Cfg[]
}

/** Create a fixture provider through the API (fast path for UI-under-test setup). */
async function createProvider(
  api: APIRequestContext,
  label: string,
  extra: Record<string, unknown> = {},
): Promise<Cfg> {
  const res = await api.post('/api/tenants/llm-configs', {
    data: {
      label,
      kind: 'openai_compatible',
      modelId: 'e2e-fixture-model',
      apiKey: 'sk-e2e-fixture-key',
      baseUrl: UNREACHABLE_BASE_URL,
      ...extra,
    },
    failOnStatusCode: false,
  })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()).config as Cfg
}

/**
 * The <Card> that renders one provider row. Scoping by the provider's unique
 * label keeps every per-card button (Test / Edit / Set default / Disable /
 * Delete) unambiguous — filtering a bare `div` matches every ancestor too, which
 * is how the old delete test ended up clicking a different row's button.
 */
function providerCard(page: Page, label: string): Locator {
  return page.locator('div.rounded-3xl').filter({
    has: page.getByRole('heading', { name: label, exact: true }),
  })
}

function networkCard(page: Page): Locator {
  return page.locator('div.rounded-3xl').filter({
    has: page.getByRole('heading', { name: 'Network Access', exact: true }),
  })
}

/** The add/edit form (identified by its Label field, not by document order). */
function providerForm(page: Page): Locator {
  return page
    .locator('form')
    .filter({ has: page.getByPlaceholder('e.g. My Anthropic Key') })
}

function routingTable(page: Page): Locator {
  return page.locator('table', {
    has: page.getByRole('columnheader', { name: 'Task' }),
  })
}

/** The Chat row's provider <select>, pinned by the row's own description text. */
function chatRoutingSelect(page: Page): Locator {
  return routingTable(page)
    .locator('tbody tr')
    .filter({ hasText: 'Agent conversations with users' })
    .locator('select')
}

async function setNetwork(
  api: APIRequestContext,
  data: { llmAllowPrivateHosts: boolean; llmHostAllowlist: string[] },
) {
  const res = await api.patch('/api/tenants/llm-configs/network', {
    data,
    failOnStatusCode: false,
  })
  expect(res.status(), await res.text()).toBe(200)
}

// ── tenant state snapshot / restore ──────────────────────────────────────────

let initialNetwork = { llmAllowPrivateHosts: false, llmHostAllowlist: [] as string[] }
let initialDefaultId: string | null = null

test.beforeAll(async ({ playwright }) => {
  const ctx = await playwright.request.newContext({
    baseURL: BASE_URL,
    storageState: STORAGE_STATE,
  })
  try {
    const net = await ctx.get('/api/tenants/llm-configs/network')
    expect(net.status(), await net.text()).toBe(200)
    const body = await net.json()
    initialNetwork = {
      llmAllowPrivateHosts: body.llmAllowPrivateHosts ?? false,
      llmHostAllowlist: body.llmHostAllowlist ?? [],
    }

    // Remember a pre-existing default provider (if any) so the Set-default test
    // can hand it back afterwards.
    const configs = await listProviders(ctx)
    initialDefaultId =
      configs.find(c => c.isDefault && !c.label.startsWith(PREFIX))?.id ?? null
  } finally {
    await ctx.dispose()
  }
})

test.afterEach(async ({ request }) => {
  for (const cfg of await listProviders(request)) {
    if (!cfg.label.startsWith(PREFIX)) continue
    const del = await request.delete(`/api/tenants/llm-configs/${cfg.id}`, {
      failOnStatusCode: false,
    })
    expect(del.status(), `cleanup of "${cfg.label}" failed`).toBe(204)
  }

  await setNetwork(request, initialNetwork)

  if (initialDefaultId) {
    const survivor = (await listProviders(request)).find(c => c.id === initialDefaultId)
    if (survivor && !survivor.isDefault) {
      await request.patch(`/api/tenants/llm-configs/${initialDefaultId}`, {
        data: { isDefault: true },
        failOnStatusCode: false,
      })
    }
  }
})

// ── page chrome & form wiring ────────────────────────────────────────────────

test.describe('LLM Providers Settings', () => {
  test('the page renders its own header, Add Provider button and Network Access card', async ({
    page,
  }) => {
    await page.goto(PAGE_PATH)
    await expect(page).toHaveURL(new RegExp(`${PAGE_PATH}$`))

    // PageHeader (h1) + its description — both rendered by this page only.
    await expect(page.getByRole('heading', { level: 1, name: 'LLM Providers' })).toBeVisible()
    await expect(
      page.getByText(
        'Connect your own AI provider so agents in this workspace use your API key and model.',
      ),
    ).toBeVisible()

    await expect(page.getByRole('button', { name: 'Add Provider' })).toBeVisible()

    // The Network Access card only renders once the client fetch has resolved.
    const network = networkCard(page)
    await expect(network.getByRole('switch')).toBeVisible()
    await expect(network.getByPlaceholder('hostname or IP')).toBeVisible()
  })

  test('the add form exposes the real provider kinds and the recommended model per kind', async ({
    page,
  }) => {
    await page.goto(PAGE_PATH)
    await page.getByRole('button', { name: 'Add Provider' }).click()

    // The form's own CardTitle (the "Add Provider" button is unmounted while open).
    await expect(page.getByRole('heading', { name: 'Add Provider' })).toBeVisible()

    const form = providerForm(page)
    const kindSelect = form.locator('select').first()
    const modelSelect = form.locator('select').nth(1)

    // Identify each select by its own options instead of trusting the index.
    await expect(kindSelect.locator('option')).toHaveText([
      'OpenAI',
      'Anthropic',
      'OpenAI-Compatible (Groq, Mistral, etc.)',
      'Google Gemini',
      'NVIDIA (build.nvidia.com — free tier)',
    ])

    // emptyForm() defaults
    await expect(kindSelect).toHaveValue('openai')
    await expect(modelSelect).toHaveValue('gpt-4o')
    await expect(form.getByPlaceholder('e.g. My Anthropic Key')).toHaveValue('')
    await expect(form.locator('input[type="password"]')).toHaveValue('')

    // handleKindChange() swaps the model list AND pre-selects the ★ recommended id.
    await kindSelect.selectOption('anthropic')
    await expect(modelSelect).toHaveValue('claude-fable-5')
    await expect(modelSelect.locator('option')).toHaveText([
      'Claude Fable 5 ★',
      'Claude Opus 4.8',
      'Claude Sonnet 5',
      'Claude Haiku 4.5',
      'Custom model ID…',
    ])
  })

  test('choosing "Custom model ID…" reveals an empty input that keeps every character typed', async ({
    page,
  }) => {
    await page.goto(PAGE_PATH)
    await page.getByRole('button', { name: 'Add Provider' }).click()

    const form = providerForm(page)
    await form.locator('select').first().selectOption('openai')
    const modelSelect = form.locator('select').nth(1)

    await modelSelect.selectOption('__custom__')

    const customInput = form.getByPlaceholder('Enter model ID')
    await expect(customInput).toBeVisible()
    // Selecting the custom option clears modelId, so the field starts empty.
    await expect(customInput).toHaveValue('')

    // Type character by character. The input is controlled and its visibility is
    // derived state, so this is what catches a regression where it remounts (and
    // loses focus / drops characters) while the user types.
    // NOTE: the value deliberately has no prefix that equals a predefined OpenAI
    // model id — typing e.g. "o3-mini-2025-01-31" collapses the field today; see
    // the appChangesNeeded note on tracking custom mode explicitly.
    await customInput.pressSequentially('zzz-private-model-v1', { delay: 20 })
    await expect(customInput).toHaveValue('zzz-private-model-v1')
    await expect(customInput).toBeFocused()

    // While a non-predefined id is in the form the dropdown reports custom mode.
    await expect(modelSelect).toHaveValue('__custom__')

    // Picking a predefined model again retires the free-text input.
    await modelSelect.selectOption('gpt-4o-mini')
    await expect(customInput).toHaveCount(0)
    await expect(modelSelect).toHaveValue('gpt-4o-mini')
  })

  test('the openai_compatible kind swaps in free-text model, Base URL and embedding hints', async ({
    page,
  }) => {
    await page.goto(PAGE_PATH)
    await page.getByRole('button', { name: 'Add Provider' }).click()

    const form = providerForm(page)
    await form.locator('select').first().selectOption('openai_compatible')

    // No model list exists for this kind, so the model dropdown is gone entirely
    // and only the provider-kind select is left.
    await expect(form.locator('select')).toHaveCount(1)

    // handleKindChange falls back to DEFAULT_MODELS for a kind with no list.
    await expect(form.getByPlaceholder('llama-3.3-70b-versatile')).toHaveValue(
      'llama-3.3-70b-versatile',
    )
    await expect(form.getByPlaceholder('https://api.groq.com/openai/v1')).toBeVisible()

    for (const modelId of [
      'intfloat/multilingual-e5-large-instruct-maas',
      'baai/bge-m3',
      'snowflake/arctic-embed-l-v2.0',
      'nomic-embed-text',
    ]) {
      await expect(form.getByRole('button', { name: modelId, exact: true })).toBeVisible()
    }
  })

  test('the embedding hints replace the model id with the exact suggested value', async ({
    page,
  }) => {
    await page.goto(PAGE_PATH)
    await page.getByRole('button', { name: 'Add Provider' }).click()

    const form = providerForm(page)
    await form.locator('select').first().selectOption('openai_compatible')
    const modelInput = form.getByPlaceholder('llama-3.3-70b-versatile')

    await form
      .getByRole('button', { name: 'intfloat/multilingual-e5-large-instruct-maas', exact: true })
      .click()
    await expect(modelInput).toHaveValue('intfloat/multilingual-e5-large-instruct-maas')

    // A second hint replaces the first rather than appending to it.
    await form.getByRole('button', { name: 'baai/bge-m3', exact: true }).click()
    await expect(modelInput).toHaveValue('baai/bge-m3')
  })

  test('the Google Cloud URL builder composes the endpoint URL and applies it to Base URL', async ({
    page,
  }) => {
    await page.goto(PAGE_PATH)
    await page.getByRole('button', { name: 'Add Provider' }).click()

    const form = providerForm(page)
    await form.locator('select').first().selectOption('openai_compatible')
    await form.getByRole('button', { name: 'Google Cloud AI Platform URL builder' }).click()

    const projectInput = form.getByPlaceholder('your-gcp-project-id')
    await expect(projectInput).toBeVisible()
    await projectInput.fill('my-gcp-project')

    await expect(
      form.getByText(
        'https://us-central1-aiplatform.googleapis.com/v1/projects/my-gcp-project/locations/us-central1/endpoints/openapi',
        { exact: true },
      ),
    ).toBeVisible()

    // The region field feeds the same template (exact:true — the endpoint-host
    // placeholder also starts with "us-central1").
    await form.getByPlaceholder('us-central1', { exact: true }).fill('europe-west4')
    const expectedUrl =
      'https://us-central1-aiplatform.googleapis.com/v1/projects/my-gcp-project/locations/europe-west4/endpoints/openapi'
    await expect(form.getByText(expectedUrl, { exact: true })).toBeVisible()

    await form.getByRole('button', { name: 'Apply URL' }).click()

    await expect(form.getByPlaceholder('https://api.groq.com/openai/v1')).toHaveValue(expectedUrl)
    // Applying also collapses the builder.
    await expect(projectInput).toHaveCount(0)
  })

  // ── create ─────────────────────────────────────────────────────────────────

  test('saving an OpenAI provider with a predefined model persists kind, model and label', async ({
    page,
    request,
  }) => {
    const label = uniqueLabel('Predefined')

    await page.goto(PAGE_PATH)
    await page.getByRole('button', { name: 'Add Provider' }).click()

    const form = providerForm(page)
    await form.getByPlaceholder('e.g. My Anthropic Key').fill(label)
    await form.locator('select').first().selectOption('openai')
    // Deliberately NOT the emptyForm default (gpt-4o): proves the dropdown's
    // onChange actually reaches the request body.
    await form.locator('select').nth(1).selectOption('gpt-4o-mini')
    await form.locator('input[type="password"]').fill('sk-e2e-predefined-key')

    const [res] = await Promise.all([
      page.waitForResponse(
        r => r.request().method() === 'POST' && r.url().endsWith('/api/tenants/llm-configs'),
      ),
      form.getByRole('button', { name: 'Save Provider' }).click(),
    ])
    expect(res.status()).toBe(201)

    const card = providerCard(page, label)
    await expect(card).toHaveCount(1)
    await expect(card.getByText('OpenAI', { exact: true })).toBeVisible() // kind badge
    await expect(card.getByText('gpt-4o-mini', { exact: true })).toBeVisible() // CardDescription

    const created = (await listProviders(request)).find(c => c.label === label)
    expect(created, 'provider is missing from GET /api/tenants/llm-configs').toBeTruthy()
    expect(created!.kind).toBe('openai')
    expect(created!.modelId).toBe('gpt-4o-mini')
    expect(created!.baseUrl).toBeNull()
    expect(created!.isEnabled).toBe(true)
    expect(created!.isDefault).toBe(false)
  })

  test('saving an OpenAI-compatible provider persists its base URL and shows it on the card', async ({
    page,
    request,
  }) => {
    const label = uniqueLabel('Compatible')

    await page.goto(PAGE_PATH)
    await page.getByRole('button', { name: 'Add Provider' }).click()

    const form = providerForm(page)
    await form.getByPlaceholder('e.g. My Anthropic Key').fill(label)
    await form.locator('select').first().selectOption('openai_compatible')
    await form.getByPlaceholder('llama-3.3-70b-versatile').fill('e2e-compatible-model')
    await form.locator('input[type="password"]').fill('sk-e2e-compatible-key')
    await form.getByPlaceholder('https://api.groq.com/openai/v1').fill(UNREACHABLE_BASE_URL)

    const [res] = await Promise.all([
      page.waitForResponse(
        r => r.request().method() === 'POST' && r.url().endsWith('/api/tenants/llm-configs'),
      ),
      form.getByRole('button', { name: 'Save Provider' }).click(),
    ])
    expect(res.status()).toBe(201)

    const card = providerCard(page, label)
    await expect(card).toHaveCount(1)
    await expect(card.getByText('OpenAI-Compatible', { exact: true })).toBeVisible()
    await expect(
      card.getByText(`e2e-compatible-model · ${UNREACHABLE_BASE_URL}`, { exact: true }),
    ).toBeVisible()

    const created = (await listProviders(request)).find(c => c.label === label)
    expect(created, 'provider is missing from GET /api/tenants/llm-configs').toBeTruthy()
    expect(created!.kind).toBe('openai_compatible')
    expect(created!.modelId).toBe('e2e-compatible-model')
    expect(created!.baseUrl).toBe(UNREACHABLE_BASE_URL)
  })

  // ── Network Access / SSRF guard ────────────────────────────────────────────

  test('a link-local base URL is rejected while "Allow private / local hosts" is off', async ({
    page,
    request,
  }) => {
    // Guarantee the precondition rather than assume it.
    await setNetwork(request, { llmAllowPrivateHosts: false, llmHostAllowlist: [] })

    const label = uniqueLabel('SSRF Blocked')

    await page.goto(PAGE_PATH)
    const network = networkCard(page)
    await expect(network.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
    await expect(network.getByText('No hosts allowlisted')).toBeVisible()

    await page.getByRole('button', { name: 'Add Provider' }).click()
    const form = providerForm(page)
    await form.getByPlaceholder('e.g. My Anthropic Key').fill(label)
    await form.locator('select').first().selectOption('openai_compatible')
    await form.getByPlaceholder('llama-3.3-70b-versatile').fill('metadata-probe')
    await form.locator('input[type="password"]').fill('sk-e2e-ssrf')
    await form
      .getByPlaceholder('https://api.groq.com/openai/v1')
      .fill(`http://${METADATA_HOST}/v1`)

    const [res] = await Promise.all([
      page.waitForResponse(
        r => r.request().method() === 'POST' && r.url().endsWith('/api/tenants/llm-configs'),
      ),
      form.getByRole('button', { name: 'Save Provider' }).click(),
    ])

    expect(res.status()).toBe(400)
    expect((await res.json()).error).toContain(
      'Private, loopback, and link-local addresses are not allowed',
    )

    // The guard's reason is surfaced to the user (assert first — toasts expire).
    // AppToaster stamps role="alert" on error toasts; role="status" is the
    // success/blank variant and would never carry this copy.
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Private, loopback, and link-local addresses are not allowed' }),
    ).toBeVisible()

    // The form stays open (closeForm only runs on success) and nothing was added.
    await expect(form.getByRole('button', { name: 'Save Provider' })).toBeVisible()
    await expect(providerCard(page, label)).toHaveCount(0)
    expect((await listProviders(request)).some(c => c.label === label)).toBe(false)
  })

  test('allowlisting a private host unblocks that base URL, and the entry survives a reload', async ({
    page,
    request,
  }) => {
    await setNetwork(request, { llmAllowPrivateHosts: false, llmHostAllowlist: [] })

    const host = '192.168.77.77'
    const label = uniqueLabel('Allowlisted')

    await page.goto(PAGE_PATH)
    const network = networkCard(page)
    await expect(network.getByText('No hosts allowlisted')).toBeVisible()

    await network.getByPlaceholder('hostname or IP').fill(host)
    const [netRes] = await Promise.all([
      page.waitForResponse(
        r =>
          r.request().method() === 'PATCH' &&
          r.url().endsWith('/api/tenants/llm-configs/network'),
      ),
      network.getByRole('button', { name: 'Add', exact: true }).click(),
    ])
    expect(netRes.status()).toBe(200)

    await expect(network.getByText(host, { exact: true })).toBeVisible()

    const stored = await request.get('/api/tenants/llm-configs/network')
    expect(stored.status()).toBe(200)
    expect((await stored.json()).llmHostAllowlist).toEqual([host])

    // …and the chip is still there after a full reload (server state, not local).
    await page.reload()
    await expect(networkCard(page).getByText(host, { exact: true })).toBeVisible()

    // The same address is now accepted by the save-time guard.
    const baseUrl = `http://${host}:11434/v1`
    await page.getByRole('button', { name: 'Add Provider' }).click()
    const form = providerForm(page)
    await form.getByPlaceholder('e.g. My Anthropic Key').fill(label)
    await form.locator('select').first().selectOption('openai_compatible')
    await form.getByPlaceholder('llama-3.3-70b-versatile').fill('local-ollama-model')
    await form.locator('input[type="password"]').fill('sk-e2e-allowlisted')
    await form.getByPlaceholder('https://api.groq.com/openai/v1').fill(baseUrl)

    const [res] = await Promise.all([
      page.waitForResponse(
        r => r.request().method() === 'POST' && r.url().endsWith('/api/tenants/llm-configs'),
      ),
      form.getByRole('button', { name: 'Save Provider' }).click(),
    ])
    expect(res.status()).toBe(201)

    await expect(providerCard(page, label)).toHaveCount(1)
    expect((await listProviders(request)).find(c => c.label === label)!.baseUrl).toBe(baseUrl)
  })

  test('turning on "Allow private / local hosts" persists and unblocks private base URLs', async ({
    page,
    request,
  }) => {
    await setNetwork(request, { llmAllowPrivateHosts: false, llmHostAllowlist: [] })

    const label = uniqueLabel('Private OK')
    const baseUrl = 'http://10.1.2.3:11434/v1'

    await page.goto(PAGE_PATH)
    const toggle = networkCard(page).getByRole('switch')
    await expect(toggle).toHaveAttribute('aria-checked', 'false')

    const [netRes] = await Promise.all([
      page.waitForResponse(
        r =>
          r.request().method() === 'PATCH' &&
          r.url().endsWith('/api/tenants/llm-configs/network'),
      ),
      toggle.click(),
    ])
    expect(netRes.status()).toBe(200)
    await expect(toggle).toHaveAttribute('aria-checked', 'true')

    await page.reload()
    await expect(networkCard(page).getByRole('switch')).toHaveAttribute('aria-checked', 'true')

    const stored = await request.get('/api/tenants/llm-configs/network')
    expect(stored.status()).toBe(200)
    expect((await stored.json()).llmAllowPrivateHosts).toBe(true)

    await page.getByRole('button', { name: 'Add Provider' }).click()
    const form = providerForm(page)
    await form.getByPlaceholder('e.g. My Anthropic Key').fill(label)
    await form.locator('select').first().selectOption('openai_compatible')
    await form.getByPlaceholder('llama-3.3-70b-versatile').fill('lan-model')
    await form.locator('input[type="password"]').fill('sk-e2e-private-ok')
    await form.getByPlaceholder('https://api.groq.com/openai/v1').fill(baseUrl)

    const [res] = await Promise.all([
      page.waitForResponse(
        r => r.request().method() === 'POST' && r.url().endsWith('/api/tenants/llm-configs'),
      ),
      form.getByRole('button', { name: 'Save Provider' }).click(),
    ])
    expect(res.status()).toBe(201)

    await expect(providerCard(page, label)).toHaveCount(1)
    expect((await listProviders(request)).find(c => c.label === label)!.baseUrl).toBe(baseUrl)
  })

  // ── edit / lifecycle ───────────────────────────────────────────────────────

  test('editing without retyping the API key never sends apiKey and leaves the rest intact', async ({
    page,
    request,
  }) => {
    const label = uniqueLabel('Edit Me')
    const created = await createProvider(request, label)
    const renamed = `${label} renamed`

    await page.goto(PAGE_PATH)
    await providerCard(page, label).getByRole('button', { name: `Edit ${label}` }).click()

    await expect(page.getByRole('heading', { name: 'Edit Provider' })).toBeVisible()
    await expect(page.getByText('Leave API key blank to keep the existing key.')).toBeVisible()

    const form = providerForm(page)
    // openEdit() blanks the key on purpose — the stored secret never reaches the browser.
    await expect(form.locator('input[type="password"]')).toHaveValue('')
    // …while everything else is pre-filled from the row.
    await expect(form.getByPlaceholder('e.g. My Anthropic Key')).toHaveValue(label)
    await expect(form.getByPlaceholder('llama-3.3-70b-versatile')).toHaveValue('e2e-fixture-model')
    await expect(form.getByPlaceholder('https://api.groq.com/openai/v1')).toHaveValue(
      UNREACHABLE_BASE_URL,
    )

    await form.getByPlaceholder('e.g. My Anthropic Key').fill(renamed)

    const patchUrl = `/api/tenants/llm-configs/${created.id}`
    const [patchRequest, patchResponse] = await Promise.all([
      page.waitForRequest(r => r.method() === 'PATCH' && r.url().includes(patchUrl)),
      page.waitForResponse(
        r => r.request().method() === 'PATCH' && r.url().includes(patchUrl),
      ),
      form.getByRole('button', { name: 'Update Provider' }).click(),
    ])

    // The regression this pins: sending an empty apiKey on an untouched key field
    // would either 400 (schema is min(1)) or overwrite the tenant's sealed key.
    expect(Object.keys(patchRequest.postDataJSON())).not.toContain('apiKey')
    expect(patchResponse.status()).toBe(200)

    await expect(providerCard(page, renamed)).toHaveCount(1)
    await expect(providerCard(page, label)).toHaveCount(0)

    const after = (await listProviders(request)).find(c => c.id === created.id)
    expect(after, 'the edited provider disappeared').toBeTruthy()
    expect(after!.label).toBe(renamed)
    expect(after!.modelId).toBe('e2e-fixture-model')
    expect(after!.baseUrl).toBe(UNREACHABLE_BASE_URL)
    expect(after!.isEnabled).toBe(true)
  })

  test('Set default moves the Default badge, is exclusive, and survives a reload', async ({
    page,
    request,
  }) => {
    const labelA = uniqueLabel('Default A')
    const labelB = uniqueLabel('Default B')
    const a = await createProvider(request, labelA, { isDefault: true })
    const b = await createProvider(request, labelB)

    await page.goto(PAGE_PATH)
    const cardA = providerCard(page, labelA)
    const cardB = providerCard(page, labelB)
    // Both rows must be on screen before any toHaveCount(0) below, otherwise a
    // still-loading list would satisfy it vacuously.
    await expect(cardA).toHaveCount(1)
    await expect(cardB).toHaveCount(1)

    await expect(cardA.getByText('Default', { exact: true })).toBeVisible()
    await expect(cardB.getByText('Default', { exact: true })).toHaveCount(0)
    // The current default offers no "Set default" button.
    await expect(cardA.getByRole('button', { name: 'Set default' })).toHaveCount(0)

    const [res] = await Promise.all([
      page.waitForResponse(
        r =>
          r.request().method() === 'PATCH' &&
          r.url().includes(`/api/tenants/llm-configs/${b.id}`),
      ),
      cardB.getByRole('button', { name: 'Set default' }).click(),
    ])
    expect(res.status()).toBe(200)

    await expect(cardB.getByText('Default', { exact: true })).toBeVisible()
    await expect(cardA.getByText('Default', { exact: true })).toHaveCount(0)

    await page.reload()
    await expect(providerCard(page, labelB).getByText('Default', { exact: true })).toBeVisible()

    const configs = await listProviders(request)
    expect(configs.find(c => c.id === b.id)!.isDefault).toBe(true)
    expect(configs.find(c => c.id === a.id)!.isDefault).toBe(false)
  })

  test('disabling a provider hides it from Task Routing; enabling brings it back', async ({
    page,
    request,
  }) => {
    const label = uniqueLabel('Toggle')
    const cfg = await createProvider(request, label)

    await page.goto(PAGE_PATH)
    const card = providerCard(page, label)
    await expect(card).toHaveCount(1)

    const option = chatRoutingSelect(page).locator('option', { hasText: label })
    await expect(option).toHaveCount(1)
    await expect(option).toHaveText(`${label} (OpenAI-Compatible · e2e-fixture-model)`)

    const [disabled] = await Promise.all([
      page.waitForResponse(
        r =>
          r.request().method() === 'PATCH' &&
          r.url().includes(`/api/tenants/llm-configs/${cfg.id}`),
      ),
      card.getByRole('button', { name: 'Disable' }).click(),
    ])
    expect(disabled.status()).toBe(200)

    await expect(card.getByText('Disabled', { exact: true })).toBeVisible()
    // configs.filter(c => c.isEnabled) — a disabled provider must not be assignable.
    await expect(chatRoutingSelect(page).locator('option', { hasText: label })).toHaveCount(0)
    expect((await listProviders(request)).find(c => c.id === cfg.id)!.isEnabled).toBe(false)

    const [enabled] = await Promise.all([
      page.waitForResponse(
        r =>
          r.request().method() === 'PATCH' &&
          r.url().includes(`/api/tenants/llm-configs/${cfg.id}`),
      ),
      card.getByRole('button', { name: 'Enable' }).click(),
    ])
    expect(enabled.status()).toBe(200)

    await expect(card.getByText('Disabled', { exact: true })).toHaveCount(0)
    await expect(chatRoutingSelect(page).locator('option', { hasText: label })).toHaveCount(1)
    expect((await listProviders(request)).find(c => c.id === cfg.id)!.isEnabled).toBe(true)
  })

  // ── task routing ───────────────────────────────────────────────────────────

  test('the Task Routing matrix lists every task and persists a Chat assignment', async ({
    page,
    request,
  }) => {
    // Guarantee both preconditions the matrix needs: at least one provider, and a
    // known starting point for the chat row.
    const label = uniqueLabel('Routing')
    const cfg = await createProvider(request, label)
    const cleared = await request.put('/api/tenants/llm-configs/tasks', {
      data: { task: 'chat', configId: null },
      failOnStatusCode: false,
    })
    expect(cleared.status()).toBe(200)

    await page.goto(PAGE_PATH)
    await expect(page.getByRole('heading', { name: 'Task Routing' })).toBeVisible()

    // Every row from TASK_LABELS. A cell's accessible name is "<label><description>",
    // so anchor the match at the start.
    for (const taskLabel of ['Chat', 'Embeddings', 'Agent Builder', 'Default']) {
      await expect(
        routingTable(page).getByRole('cell', { name: new RegExp(`^${taskLabel}`) }),
      ).toBeVisible()
    }

    const chatSelect = chatRoutingSelect(page)
    await expect(chatSelect).toHaveValue('')

    const [assigned] = await Promise.all([
      page.waitForResponse(
        r =>
          r.request().method() === 'PUT' &&
          r.url().endsWith('/api/tenants/llm-configs/tasks'),
      ),
      chatSelect.selectOption(cfg.id),
    ])
    expect(assigned.status()).toBe(200)
    await expect(chatSelect).toHaveValue(cfg.id)

    const tasks = await request.get('/api/tenants/llm-configs/tasks')
    expect(tasks.status()).toBe(200)
    const assignments = (await tasks.json()).assignments as Array<{
      task: string
      configId: string
    }>
    expect(assignments.find(a => a.task === 'chat')?.configId).toBe(cfg.id)

    // Survives a reload…
    await page.reload()
    await expect(chatRoutingSelect(page)).toHaveValue(cfg.id)

    // …and can be handed back to default resolution.
    const [clearedAgain] = await Promise.all([
      page.waitForResponse(
        r =>
          r.request().method() === 'PUT' &&
          r.url().endsWith('/api/tenants/llm-configs/tasks'),
      ),
      chatRoutingSelect(page).selectOption(''),
    ])
    expect(clearedAgain.status()).toBe(200)

    const afterClear = await request.get('/api/tenants/llm-configs/tasks')
    expect(afterClear.status()).toBe(200)
    expect(
      ((await afterClear.json()).assignments as Array<{ task: string }>).some(
        a => a.task === 'chat',
      ),
    ).toBe(false)
  })

  // ── test connection ────────────────────────────────────────────────────────

  test('Test connection returns a sanitised failure for an unreachable provider', async ({
    page,
    request,
  }) => {
    const label = uniqueLabel('Test Conn')
    const cfg = await createProvider(request, label)

    await page.goto(PAGE_PATH)

    const [res] = await Promise.all([
      page.waitForResponse(r => r.url().includes(`/api/tenants/llm-configs/${cfg.id}/test`), {
        timeout: 60_000,
      }),
      providerCard(page, label).getByRole('button', { name: 'Test', exact: true }).click(),
    ])

    // The probe route answers 200 with an ok:false envelope — never a 5xx.
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(false)
    // …and it must never echo the raw provider/network error, which would leak
    // internal endpoint content when baseUrl points inward.
    expect(body.error).toBe('Connection failed — check your provider settings')
    expect(JSON.stringify(body)).not.toContain('e2e-provider.invalid')

    // toast.error → role="alert" (see components/toaster.tsx).
    await expect(page.getByRole('alert').filter({ hasText: 'Connection failed' })).toBeVisible()
  })

  // ── delete ─────────────────────────────────────────────────────────────────

  test('deleting a provider removes exactly that provider', async ({ page, request }) => {
    const doomedLabel = uniqueLabel('Delete Me')
    const keptLabel = uniqueLabel('Keep Me')
    const doomed = await createProvider(request, doomedLabel)
    const kept = await createProvider(request, keptLabel)

    await page.goto(PAGE_PATH)
    await expect(providerCard(page, doomedLabel)).toHaveCount(1)
    await expect(providerCard(page, keptLabel)).toHaveCount(1)

    // The row's delete button is icon-only but carries aria-label "Delete <label>".
    const [res] = await Promise.all([
      page.waitForResponse(
        r =>
          r.request().method() === 'DELETE' &&
          r.url().includes(`/api/tenants/llm-configs/${doomed.id}`),
      ),
      providerCard(page, doomedLabel)
        .getByRole('button', { name: `Delete ${doomedLabel}` })
        .click(),
    ])
    expect(res.status()).toBe(204)

    await expect(providerCard(page, doomedLabel)).toHaveCount(0)
    // The neighbour must survive: the old version scoped the click with
    // .first() over an ambiguous ancestor and could delete the wrong row.
    await expect(providerCard(page, keptLabel)).toHaveCount(1)

    const remaining = await listProviders(request)
    expect(remaining.some(c => c.id === doomed.id)).toBe(false)
    expect(remaining.some(c => c.id === kept.id)).toBe(true)
  })
})
