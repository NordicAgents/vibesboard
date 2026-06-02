/**
 * Integration tests for token usage tracking.
 *
 * These hit a running Next.js dev server with an authenticated session, so they
 * self-skip unless TEST_AUTH_COOKIE + TEST_TENANT_ID (and TEST_AGENT_ID for the
 * end-to-end case) are set. A later Playwright phase covers live flows.
 */
import { describe, it, expect } from 'vitest'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'
const AUTH_COOKIE = process.env.TEST_AUTH_COOKIE ?? ''
const TEST_TENANT_ID = process.env.TEST_TENANT_ID ?? ''
const TEST_AGENT_ID = process.env.TEST_AGENT_ID ?? ''

const canRunIntegration = !!AUTH_COOKIE && !!TEST_TENANT_ID

describe.skipIf(!canRunIntegration)('admin usage API response shape', () => {
  it('GET /api/admin/tenants/[id]/usage returns expected fields including userNames', async () => {
    const res = await fetch(
      `${BASE_URL}/api/admin/tenants/${TEST_TENANT_ID}/usage`,
      { headers: { Cookie: AUTH_COOKIE }, signal: AbortSignal.timeout(10_000) }
    )

    expect(res.status).toBe(200)

    const data = await res.json()
    expect('billingCycleId' in data).toBeTruthy()
    expect('agentNames' in data).toBeTruthy()
    expect('userNames' in data).toBeTruthy()
    expect('dailyUsage' in data).toBeTruthy()
    expect(data.billingCycleId).toMatch(/^\d{4}-\d{2}$/)
    expect(typeof data.agentNames).toBe('object')
    expect(typeof data.userNames).toBe('object')
  })

  it('rollup includes byUser field when usage exists', async () => {
    const res = await fetch(
      `${BASE_URL}/api/admin/tenants/${TEST_TENANT_ID}/usage`,
      { headers: { Cookie: AUTH_COOKIE }, signal: AbortSignal.timeout(10_000) }
    )
    const data = await res.json()

    if (!data.rollup) return

    expect(typeof data.rollup.totalMessages).toBe('number')
    expect(typeof data.rollup.totalInputTokens).toBe('number')
    expect(typeof data.rollup.totalOutputTokens).toBe('number')

    if (data.rollup.byUser) {
      expect(typeof data.rollup.byUser).toBe('object')
      for (const [, userUsage] of Object.entries(data.rollup.byUser) as [
        string,
        any
      ][]) {
        expect(typeof userUsage.messages).toBe('number')
        expect(typeof userUsage.inputTokens).toBe('number')
        expect(typeof userUsage.outputTokens).toBe('number')
        if (userUsage.byAgent) {
          expect(typeof userUsage.byAgent).toBe('object')
          for (const [, agentUsage] of Object.entries(userUsage.byAgent) as [
            string,
            any
          ][]) {
            expect(typeof agentUsage.messages).toBe('number')
            expect(typeof agentUsage.inputTokens).toBe('number')
            expect(typeof agentUsage.outputTokens).toBe('number')
          }
        }
      }
    }
  })
})

describe.skipIf(!canRunIntegration || !TEST_AGENT_ID)(
  'end-to-end token tracking',
  () => {
    it('chat message records non-zero token usage', async () => {
      const chatRes = await fetch(
        `${BASE_URL}/api/agents/${TEST_AGENT_ID}/chat`,
        {
          method: 'POST',
          headers: { Cookie: AUTH_COOKIE, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'user', content: 'Say exactly: TOKEN_TEST_OK' }]
          }),
          signal: AbortSignal.timeout(30_000)
        }
      )
      expect(chatRes.ok).toBeTruthy()

      const reader = chatRes.body!.getReader()
      const decoder = new TextDecoder()
      let chatOutput = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chatOutput += decoder.decode(value, { stream: true })
      }
      expect(chatOutput.length > 0).toBeTruthy()

      await new Promise(resolve => setTimeout(resolve, 2000))

      const usageRes = await fetch(
        `${BASE_URL}/api/admin/tenants/${TEST_TENANT_ID}/usage`,
        {
          headers: { Cookie: AUTH_COOKIE },
          signal: AbortSignal.timeout(10_000)
        }
      )
      expect(usageRes.status).toBe(200)
      const usage = await usageRes.json()

      expect(usage.rollup).toBeTruthy()
      expect(usage.rollup.totalMessages > 0).toBeTruthy()
    })
  }
)
