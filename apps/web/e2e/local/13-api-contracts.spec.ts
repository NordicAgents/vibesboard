/**
 * Section 13 — API contracts
 *
 * Regression guards for bugs that the rest of the suite could not see because
 * its assertions were too lenient (`expect(status).toBeGreaterThanOrEqual(400)`
 * treats a 500 as success) or because it never asserted persistence at all.
 *
 *   - invalid input must be 400, not an unhandled ZodError surfacing as 500
 *   - PATCH must actually persist llmConfigId, which it silently dropped while
 *     the UI reported "Changes saved"
 */
import { test, expect } from '@playwright/test'
import { STORAGE_STATE } from '../constants.ts'

test.use({ storageState: STORAGE_STATE })

// ─── Invalid input is a 400, never a 500 ─────────────────────────────────────

test.describe('Input validation returns 400', () => {
  test('POST /api/agents with a schema-invalid body', async ({ request }) => {
    const res = await request.post('/api/agents', {
      // name is required and must be a non-empty string
      data: { name: 123, instructions: [] },
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(400)
    expect(res.status()).not.toBe(500)
  })

  test('POST /api/agents with an empty name', async ({ request }) => {
    const res = await request.post('/api/agents', {
      data: { name: '' },
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(400)
  })

  test('POST /api/agents with malformed JSON', async ({ request }) => {
    const res = await request.post('/api/agents', {
      headers: { 'content-type': 'application/json' },
      data: '{ this is not json',
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(400)
  })

  test('conversations/ask with an empty question', async ({ request }) => {
    const create = await request.post('/api/agents', {
      data: { name: `Contract Agent ${Date.now()}`, instructions: 'Contract test agent instructions.' },
      failOnStatusCode: false,
    })
    expect(create.status(), await create.text()).toBeLessThan(300)
    const created = await create.json()
    const agentId = created.agent?.id ?? created.id
    expect(agentId).toBeTruthy()

    const res = await request.post(`/api/agents/${agentId}/conversations/ask`, {
      data: { question: '' },
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(400)
    expect(res.status()).not.toBe(500)

    await request.delete(`/api/agents/${agentId}`, { failOnStatusCode: false })
  })
})

// ─── PATCH persists the per-agent LLM override ───────────────────────────────

test.describe('PATCH /api/agents/[id] persists llmConfigId', () => {
  let agentId: string
  let configId: string

  test.beforeAll(async ({ playwright }) => {
    const ctx = await playwright.request.newContext({
      baseURL: 'http://localhost:3100',
      storageState: STORAGE_STATE,
    })
    try {
      const agent = await ctx.post('/api/agents', {
        data: { name: `LLM Override Agent ${Date.now()}`, instructions: 'Contract test agent instructions.' },
        failOnStatusCode: false,
      })
      expect(agent.status(), await agent.text()).toBeLessThan(300)
      const agentBody = await agent.json()
      agentId = agentBody.agent?.id ?? agentBody.id
      expect(agentId).toBeTruthy()

      const cfg = await ctx.post('/api/tenants/llm-configs', {
        data: {
          label: `E2E Override Target ${Date.now()}`,
          kind: 'openai_compatible',
          modelId: 'override-target-model',
          apiKey: 'sk-override-target',
          baseUrl: 'https://api.openai.com/v1',
        },
        failOnStatusCode: false,
      })
      expect(cfg.status(), await cfg.text()).toBe(201)
      configId = (await cfg.json()).config.id
    } finally {
      await ctx.dispose()
    }
  })

  test.afterAll(async ({ playwright }) => {
    const ctx = await playwright.request.newContext({
      baseURL: 'http://localhost:3100',
      storageState: STORAGE_STATE,
    })
    try {
      if (agentId) await ctx.delete(`/api/agents/${agentId}`, { failOnStatusCode: false })
      if (configId)
        await ctx.delete(`/api/tenants/llm-configs/${configId}`, {
          failOnStatusCode: false,
        })
    } finally {
      await ctx.dispose()
    }
  })

  test('setting llmConfigId survives a read-back', async ({ request }) => {
    const patch = await request.patch(`/api/agents/${agentId}`, {
      data: { llmConfigId: configId },
      failOnStatusCode: false,
    })
    expect(patch.status(), await patch.text()).toBeLessThan(300)

    // The bug: PATCH accepted and 200'd, but never wrote the column.
    const read = await request.get(`/api/agents/${agentId}`)
    expect(read.ok()).toBeTruthy()
    expect((await read.json()).agent.llmConfigId).toBe(configId)
  })

  test('clearing llmConfigId back to null survives a read-back', async ({
    request,
  }) => {
    await request.patch(`/api/agents/${agentId}`, {
      data: { llmConfigId: configId },
      failOnStatusCode: false,
    })
    const patch = await request.patch(`/api/agents/${agentId}`, {
      data: { llmConfigId: null },
      failOnStatusCode: false,
    })
    expect(patch.status()).toBeLessThan(300)

    const read = await request.get(`/api/agents/${agentId}`)
    expect((await read.json()).agent.llmConfigId).toBeNull()
  })
})
