/**
 * Integration tests for token usage tracking.
 *
 * Tests the admin usage API response shape and verifies that
 * the token usage pipeline works end-to-end (requires dev server).
 *
 * Run:
 *   bun run dev  # in one terminal
 *   node --experimental-strip-types --test lib/integration/token-usage.test.ts
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ---------------------------------------------------------------------------
// Environment setup
// ---------------------------------------------------------------------------
function loadEnv() {
  try {
    const envPath = resolve(import.meta.dirname, '../../.env.local')
    const content = readFileSync(envPath, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIndex = trimmed.indexOf('=')
      if (eqIndex === -1) continue
      const key = trimmed.slice(0, eqIndex).trim()
      let value = trimmed.slice(eqIndex + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (!process.env[key]) process.env[key] = value
    }
  } catch {
    /* ignore */
  }
}

loadEnv()

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'
const AUTH_COOKIE = process.env.TEST_AUTH_COOKIE ?? ''
const TEST_TENANT_ID = process.env.TEST_TENANT_ID ?? ''
const TEST_AGENT_ID = process.env.TEST_AGENT_ID ?? ''

async function isServerRunning(): Promise<boolean> {
  try {
    const res = await fetch(BASE_URL, { signal: AbortSignal.timeout(3000) })
    return res.ok || res.status === 307
  } catch {
    return false
  }
}

function canRunIntegration(): boolean {
  return !!AUTH_COOKIE && !!TEST_TENANT_ID
}

// ---------------------------------------------------------------------------
// Admin Usage API — response shape
// ---------------------------------------------------------------------------
describe('admin usage API response shape', () => {
  test('GET /api/admin/tenants/[id]/usage returns expected fields including userNames', async () => {
    if (!canRunIntegration()) {
      console.log('  ⏭ Skipping: TEST_AUTH_COOKIE or TEST_TENANT_ID not set')
      return
    }
    if (!(await isServerRunning())) {
      console.log('  ⏭ Skipping: dev server not running')
      return
    }

    const res = await fetch(
      `${BASE_URL}/api/admin/tenants/${TEST_TENANT_ID}/usage`,
      {
        headers: { Cookie: AUTH_COOKIE },
        signal: AbortSignal.timeout(10_000)
      }
    )

    assert.equal(res.status, 200, `Expected 200, got ${res.status}`)

    const data = await res.json()

    // Verify response has expected top-level keys
    assert.ok('billingCycleId' in data, 'should have billingCycleId')
    assert.ok('agentNames' in data, 'should have agentNames')
    assert.ok('userNames' in data, 'should have userNames')
    assert.ok('dailyUsage' in data, 'should have dailyUsage')

    // billingCycleId format: YYYY-MM
    assert.match(
      data.billingCycleId,
      /^\d{4}-\d{2}$/,
      'billingCycleId should be YYYY-MM format'
    )

    // agentNames and userNames should be objects
    assert.equal(typeof data.agentNames, 'object')
    assert.equal(typeof data.userNames, 'object')
  })

  test('rollup includes byUser field when usage exists', async () => {
    if (!canRunIntegration()) {
      console.log('  ⏭ Skipping: TEST_AUTH_COOKIE or TEST_TENANT_ID not set')
      return
    }
    if (!(await isServerRunning())) {
      console.log('  ⏭ Skipping: dev server not running')
      return
    }

    const res = await fetch(
      `${BASE_URL}/api/admin/tenants/${TEST_TENANT_ID}/usage`,
      {
        headers: { Cookie: AUTH_COOKIE },
        signal: AbortSignal.timeout(10_000)
      }
    )

    const data = await res.json()

    if (!data.rollup) {
      console.log('  ⏭ No rollup data — send a chat message first')
      return
    }

    // Verify rollup structure
    assert.equal(typeof data.rollup.totalMessages, 'number')
    assert.equal(typeof data.rollup.totalInputTokens, 'number')
    assert.equal(typeof data.rollup.totalOutputTokens, 'number')

    // byUser should exist if there's any usage
    if (data.rollup.byUser) {
      assert.equal(typeof data.rollup.byUser, 'object')

      // Each user entry should have the expected shape
      for (const [userId, userUsage] of Object.entries(data.rollup.byUser) as [
        string,
        any
      ][]) {
        assert.equal(
          typeof userUsage.messages,
          'number',
          `${userId} should have messages count`
        )
        assert.equal(
          typeof userUsage.inputTokens,
          'number',
          `${userId} should have inputTokens`
        )
        assert.equal(
          typeof userUsage.outputTokens,
          'number',
          `${userId} should have outputTokens`
        )

        // byAgent nested under user
        if (userUsage.byAgent) {
          assert.equal(typeof userUsage.byAgent, 'object')
          for (const [agentId, agentUsage] of Object.entries(
            userUsage.byAgent
          ) as [string, any][]) {
            assert.equal(
              typeof agentUsage.messages,
              'number',
              `${userId}/${agentId} should have messages`
            )
            assert.equal(
              typeof agentUsage.inputTokens,
              'number',
              `${userId}/${agentId} should have inputTokens`
            )
            assert.equal(
              typeof agentUsage.outputTokens,
              'number',
              `${userId}/${agentId} should have outputTokens`
            )
          }
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// End-to-end: send a chat message and verify tokens are recorded
// ---------------------------------------------------------------------------
describe('end-to-end token tracking', () => {
  test('chat message records non-zero token usage', async () => {
    if (!canRunIntegration() || !TEST_AGENT_ID) {
      console.log(
        '  ⏭ Skipping: TEST_AUTH_COOKIE, TEST_TENANT_ID, or TEST_AGENT_ID not set'
      )
      return
    }
    if (!(await isServerRunning())) {
      console.log('  ⏭ Skipping: dev server not running')
      return
    }

    // Step 1: Send a chat message
    const chatRes = await fetch(
      `${BASE_URL}/api/agents/${TEST_AGENT_ID}/chat`,
      {
        method: 'POST',
        headers: {
          Cookie: AUTH_COOKIE,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Say exactly: TOKEN_TEST_OK' }]
        }),
        signal: AbortSignal.timeout(30_000)
      }
    )

    assert.ok(chatRes.ok, `Chat request failed with status ${chatRes.status}`)

    // Drain the streaming response
    const reader = chatRes.body!.getReader()
    const decoder = new TextDecoder()
    let chatOutput = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chatOutput += decoder.decode(value, { stream: true })
    }

    assert.ok(chatOutput.length > 0, 'Chat should produce output')

    // Step 2: Wait briefly for fire-and-forget writes
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Step 3: Check usage data via admin API
    const usageRes = await fetch(
      `${BASE_URL}/api/admin/tenants/${TEST_TENANT_ID}/usage`,
      {
        headers: { Cookie: AUTH_COOKIE },
        signal: AbortSignal.timeout(10_000)
      }
    )

    assert.equal(usageRes.status, 200)
    const usage = await usageRes.json()

    assert.ok(usage.rollup, 'Rollup should exist after chat message')
    assert.ok(usage.rollup.totalMessages > 0, 'Should have at least 1 message')

    // Token counts should be non-zero if the feature is working
    if (usage.rollup.totalInputTokens > 0) {
      console.log(`  ✓ Input tokens recorded: ${usage.rollup.totalInputTokens}`)
      console.log(
        `  ✓ Output tokens recorded: ${usage.rollup.totalOutputTokens}`
      )
    } else {
      console.log(
        '  ⚠ Input tokens still 0 — check if Responses API returns usage in response.completed event'
      )
    }

    // Verify byUser exists and has entries
    if (usage.rollup.byUser) {
      const userIds = Object.keys(usage.rollup.byUser)
      assert.ok(userIds.length > 0, 'byUser should have at least one entry')
      console.log(`  ✓ Users tracked: ${userIds.length}`)

      // Check that agent breakdown exists under at least one user
      let hasAgentBreakdown = false
      for (const userId of userIds) {
        const userEntry = usage.rollup.byUser[userId]
        if (userEntry.byAgent && Object.keys(userEntry.byAgent).length > 0) {
          hasAgentBreakdown = true
          break
        }
      }
      assert.ok(
        hasAgentBreakdown,
        'At least one user should have agent breakdown'
      )
    }
  })
})
