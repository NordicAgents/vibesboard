/**
 * Section 4 — LLM Providers Settings
 *
 * Covers:
 *   - LLM providers page loads
 *   - Can add an OpenAI-compatible provider with a custom model ID (tests the
 *     bug fix: selecting "Custom model ID…" must show the text input)
 *   - Custom model ID text input appears and is editable
 *   - Can add an OpenAI provider with a predefined model
 *   - Provider appears in the list after saving
 *   - Task routing table is visible
 *   - Can delete a provider
 */
import { test, expect } from '@playwright/test'
import { STORAGE_STATE } from '../constants.ts'

test.use({ storageState: STORAGE_STATE })

test.describe('LLM Providers Settings', () => {
  test('settings page loads and shows the Add Provider button', async ({ page }) => {
    await page.goto('/settings/tenant/llm-providers')
    await expect(page).not.toHaveURL(/sign-in/)
    await expect(
      page.getByRole('button', { name: /add provider/i }).or(
        page.getByText(/add provider/i)
      )
    ).toBeVisible({ timeout: 10_000 })
  })

  test('opening the add form shows the provider kind selector', async ({ page }) => {
    await page.goto('/settings/tenant/llm-providers')

    await page.getByRole('button', { name: /add provider/i }).click()

    // Provider kind select should be visible
    await expect(page.locator('select').first()).toBeVisible()

    // Label field should be present
    await expect(page.locator('input[placeholder*="My" i], input[placeholder*="label" i], input[placeholder*="name" i]').first()).toBeVisible()
  })

  test('selecting a predefined OpenAI model works', async ({ page }) => {
    await page.goto('/settings/tenant/llm-providers')
    await page.getByRole('button', { name: /add provider/i }).click()

    // Set kind to openai
    const kindSelect = page.locator('select').first()
    await kindSelect.selectOption('openai')

    // Model dropdown should appear with predefined models
    const modelSelect = page.locator('select').nth(1)
    await expect(modelSelect).toBeVisible()

    // Select GPT-4o
    await modelSelect.selectOption('gpt-4o')

    // Verify the selection
    await expect(modelSelect).toHaveValue('gpt-4o')
  })

  test('selecting "Custom model ID…" reveals the free-text input (bug fix)', async ({ page }) => {
    await page.goto('/settings/tenant/llm-providers')
    await page.getByRole('button', { name: /add provider/i }).click()

    // Set kind to openai (has a predefined model list)
    const kindSelect = page.locator('select').first()
    await kindSelect.selectOption('openai')

    const modelSelect = page.locator('select').nth(1)
    await expect(modelSelect).toBeVisible()

    // Select the custom option
    await modelSelect.selectOption('__custom__')

    // The free-text input MUST appear (this was the bug)
    const customInput = page.locator('input[placeholder*="model id" i], input[placeholder*="Enter model" i]')
    await expect(customInput).toBeVisible({ timeout: 5_000 })

    // Use an ID that is NOT in the predefined list — filling a known model ID would make
    // the condition false and hide the custom input again
    await customInput.fill('my-custom-model-xyz')
    await expect(customInput).toHaveValue('my-custom-model-xyz')
  })

  test('openai_compatible kind shows base URL and embedding hint', async ({ page }) => {
    await page.goto('/settings/tenant/llm-providers')
    await page.getByRole('button', { name: /add provider/i }).click()

    const kindSelect = page.locator('select').first()
    await kindSelect.selectOption('openai_compatible')

    // Base URL input should appear
    await expect(page.locator('input[placeholder*="groq" i], input[placeholder*="baseurl" i], input[placeholder*="base url" i], input[placeholder*="https://api" i]').first()).toBeVisible()

    // Embedding hint should appear with Google Cloud MaaS model
    await expect(page.getByText(/multilingual-e5-large-instruct-maas/i)).toBeVisible()
    await expect(page.getByText(/nomic-embed-text/i)).toBeVisible()
  })

  test('clicking multilingual-e5 hint fills the Google Cloud model ID', async ({ page }) => {
    await page.goto('/settings/tenant/llm-providers')
    await page.getByRole('button', { name: /add provider/i }).click()

    const kindSelect = page.locator('select').first()
    await kindSelect.selectOption('openai_compatible')

    // Click the Google Cloud MaaS e5 suggestion button
    await page.getByRole('button', { name: /multilingual-e5-large-instruct-maas/i }).click()

    // Model ID input should be filled with the full model path
    const modelInput = page.locator('input[placeholder*="llama" i], input[placeholder*="model" i]').first()
    await expect(modelInput).toHaveValue('intfloat/multilingual-e5-large-instruct-maas')
  })

  test('Google Cloud URL builder constructs correct endpoint URL', async ({ page }) => {
    await page.goto('/settings/tenant/llm-providers')
    await page.getByRole('button', { name: /add provider/i }).click()

    const kindSelect = page.locator('select').first()
    await kindSelect.selectOption('openai_compatible')

    // Expand the Google Cloud URL builder
    await page.getByRole('button', { name: /google cloud ai platform url builder/i }).click()

    // Fill in the fields
    const projectInput = page.locator('input[placeholder*="project" i]').first()
    await expect(projectInput).toBeVisible({ timeout: 5_000 })
    await projectInput.fill('my-gcp-project')

    // The built URL should appear
    await expect(
      page.getByText(/us-central1-aiplatform.googleapis.com\/v1\/projects\/my-gcp-project/)
    ).toBeVisible({ timeout: 3_000 })

    // Click Apply URL
    await page.getByRole('button', { name: /apply url/i }).click()

    // Base URL input should now be filled
    const baseUrlInput = page.locator('input[placeholder*="groq" i], input[placeholder*="https://api" i]').first()
    await expect(baseUrlInput).toHaveValue(/my-gcp-project/)
  })

  test('can save a new OpenAI-compatible provider', async ({ page }) => {
    await page.goto('/settings/tenant/llm-providers')
    await page.getByRole('button', { name: /add provider/i }).click()

    // Fill the form
    const labelInput = page.locator('input').first()
    await labelInput.fill('E2E Test Provider')

    const kindSelect = page.locator('select').first()
    await kindSelect.selectOption('openai_compatible')

    const modelInput = page.locator('input[placeholder*="llama" i]').first()
    await modelInput.fill('test-model-e2e')

    const apiKeyInput = page.locator('input[type="password"]').first()
    await apiKeyInput.fill('sk-e2e-test-key-12345')

    const baseUrlInput = page.locator('input[placeholder*="groq" i], input[placeholder*="https://api" i]').first()
    await baseUrlInput.fill('https://api.openai.com/v1')

    // Save
    await page.getByRole('button', { name: /save provider/i }).click()

    // Provider should appear in the list — multiple runs accumulate, use .first()
    await expect(page.getByRole('heading', { name: 'E2E Test Provider' }).first()).toBeVisible({ timeout: 10_000 })
  })

  test('task routing table appears when a provider is configured', async ({ page, request }) => {
    // Guarantee the precondition instead of detecting it. The old version
    // probed for `[data-testid="provider-card"]` / `.provider-item` — neither
    // selector exists in the app — and then read "task routing" synchronously,
    // before the client-side fetch had populated `configs`. Both signals were
    // therefore false and the test silently `test.skip()`ed on every run.
    const list = await request.get('/api/tenants/llm-configs')
    expect(list.ok()).toBeTruthy()
    const { configs } = await list.json()
    if ((configs ?? []).length === 0) {
      const created = await request.post('/api/tenants/llm-configs', {
        data: {
          label: 'E2E Routing Precondition',
          kind: 'openai_compatible',
          modelId: 'routing-precondition-model',
          apiKey: 'sk-routing-precondition',
          baseUrl: 'https://api.openai.com/v1',
        },
        failOnStatusCode: false,
      })
      expect(created.status()).toBe(201)
    }

    await page.goto('/settings/tenant/llm-providers')
    // The matrix renders only once `configs` has loaded (configs.length > 0
    // && !isFormOpen), so wait for it rather than sampling immediately.
    await expect(
      page.getByRole('heading', { name: 'Task Routing' })
    ).toBeVisible({ timeout: 15_000 })
    // Every task row from TASK_LABELS must be present. Each cell's accessible
    // name is "<label><description>", so anchor the match at the start.
    const routingTable = page.locator('table', {
      has: page.getByRole('columnheader', { name: 'Task' }),
    })
    for (const label of ['Chat', 'Embeddings', 'Agent Builder', 'Default']) {
      await expect(
        routingTable.getByRole('cell', { name: new RegExp(`^${label}`) })
      ).toBeVisible()
    }
  })

  test('can delete a provider', async ({ page }) => {
    // A unique label per run, so the assertions below are about THIS provider
    // and cannot be satisfied by a leftover from an earlier run.
    const label = `E2E Delete Me ${Date.now()}`

    await page.goto('/settings/tenant/llm-providers')

    // Add a provider to delete
    await page.getByRole('button', { name: /add provider/i }).click()
    const labelInput = page.locator('input').first()
    await labelInput.fill(label)

    const kindSelect = page.locator('select').first()
    await kindSelect.selectOption('openai_compatible')

    const modelInput = page.locator('input[placeholder*="llama" i]').first()
    await modelInput.fill('delete-me-model')

    await page.locator('input[type="password"]').first().fill('sk-delete-me')
    await page.locator('input[placeholder*="groq" i], input[placeholder*="https://api" i]').first().fill('https://api.openai.com/v1')

    await page.getByRole('button', { name: /save provider/i }).click()
    await expect(page.getByRole('heading', { name: label })).toBeVisible({ timeout: 10_000 })

    // Each row's delete button is icon-only but carries an accessible name
    // ("Delete <label>"), so this targets exactly the provider under test.
    // The previous version scoped with page.locator('div').filter({has: …})
    // .first(), which resolves to the OUTERMOST matching ancestor — every
    // card's delete button was in scope and `.first()` deleted the OLDEST
    // provider instead.
    await page.getByRole('button', { name: `Delete ${label}` }).click()

    // The provider must actually be gone from the list (the old assertion —
    // "no error toast" — passed even when the wrong row was deleted).
    await expect(page.getByRole('heading', { name: label })).toHaveCount(0, {
      timeout: 10_000,
    })

    // …and gone from the server, not just the client-side list.
    const after = await page.request.get('/api/tenants/llm-configs')
    expect(after.ok()).toBeTruthy()
    const { configs } = await after.json()
    expect((configs ?? []).some((c: { label: string }) => c.label === label)).toBe(false)
  })
})
