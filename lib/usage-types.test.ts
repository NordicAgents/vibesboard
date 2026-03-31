/**
 * Tests for the UsageRollupDocument type hierarchy.
 *
 * Verifies that the byUser field structure supports the
 * user -> agent -> tenant breakdown pattern.
 *
 * Run:
 *   node --experimental-strip-types --test lib/usage-types.test.ts
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import type {
  UsageRollupDocument,
  UserUsage,
  UserAgentUsage
} from './firestore-types.ts'

describe('UsageRollupDocument type hierarchy', () => {
  test('byUser supports user -> agent -> tenant structure', () => {
    const rollup: UsageRollupDocument = {
      tenantId: 'tenant-1',
      billingCycleId: '2026-04',
      totalMessages: 100,
      totalInputTokens: 50000,
      totalOutputTokens: 25000,
      bySource: { chat: 80, public_chat: 20 },
      byAgent: { 'agent-1': 60, 'agent-2': 40 },
      byModel: { 'gpt-5.4-nano': 100 },
      byUser: {
        'user-1': {
          messages: 60,
          inputTokens: 30000,
          outputTokens: 15000,
          byAgent: {
            'agent-1': { messages: 40, inputTokens: 20000, outputTokens: 10000 },
            'agent-2': { messages: 20, inputTokens: 10000, outputTokens: 5000 }
          }
        },
        'user-2': {
          messages: 20,
          inputTokens: 10000,
          outputTokens: 5000,
          byAgent: {
            'agent-1': { messages: 20, inputTokens: 10000, outputTokens: 5000 }
          }
        },
        '_anonymous': {
          messages: 20,
          inputTokens: 10000,
          outputTokens: 5000,
          byAgent: {
            'agent-2': { messages: 20, inputTokens: 10000, outputTokens: 5000 }
          }
        }
      },
      updatedAt: '2026-04-01T00:00:00Z'
    }

    // Tenant-level totals
    assert.equal(rollup.totalMessages, 100)
    assert.equal(rollup.totalInputTokens, 50000)

    // User-level breakdown
    const user1 = rollup.byUser['user-1']
    assert.equal(user1.messages, 60)
    assert.equal(user1.inputTokens, 30000)

    // User -> Agent breakdown
    const user1Agent1 = user1.byAgent['agent-1']
    assert.equal(user1Agent1.messages, 40)
    assert.equal(user1Agent1.inputTokens, 20000)
    assert.equal(user1Agent1.outputTokens, 10000)

    // Anonymous user
    const anon = rollup.byUser['_anonymous']
    assert.equal(anon.messages, 20)
    assert.ok(anon.byAgent['agent-2'], 'anonymous should have agent-2 usage')
  })

  test('UserUsage interface has required fields', () => {
    const usage: UserUsage = {
      messages: 10,
      inputTokens: 5000,
      outputTokens: 2500,
      byAgent: {}
    }

    assert.equal(usage.messages, 10)
    assert.equal(usage.inputTokens, 5000)
    assert.equal(usage.outputTokens, 2500)
    assert.deepEqual(usage.byAgent, {})
  })

  test('UserAgentUsage interface has required fields', () => {
    const agentUsage: UserAgentUsage = {
      messages: 5,
      inputTokens: 2500,
      outputTokens: 1000
    }

    assert.equal(agentUsage.messages, 5)
    assert.equal(agentUsage.inputTokens, 2500)
    assert.equal(agentUsage.outputTokens, 1000)
  })

  test('user totals can be derived by summing agent usage', () => {
    const user: UserUsage = {
      messages: 15,
      inputTokens: 7500,
      outputTokens: 3500,
      byAgent: {
        'agent-A': { messages: 10, inputTokens: 5000, outputTokens: 2000 },
        'agent-B': { messages: 5, inputTokens: 2500, outputTokens: 1500 }
      }
    }

    // Sum agent messages
    const sumMessages = Object.values(user.byAgent).reduce((s, a) => s + a.messages, 0)
    assert.equal(sumMessages, user.messages, 'user messages should equal sum of agent messages')

    // Sum agent input tokens
    const sumInput = Object.values(user.byAgent).reduce((s, a) => s + a.inputTokens, 0)
    assert.equal(sumInput, user.inputTokens, 'user inputTokens should equal sum of agent inputTokens')

    // Sum agent output tokens
    const sumOutput = Object.values(user.byAgent).reduce((s, a) => s + a.outputTokens, 0)
    assert.equal(sumOutput, user.outputTokens, 'user outputTokens should equal sum of agent outputTokens')
  })

  test('tenant totals can be derived by summing user usage', () => {
    const rollup: UsageRollupDocument = {
      tenantId: 't',
      billingCycleId: '2026-04',
      totalMessages: 30,
      totalInputTokens: 15000,
      totalOutputTokens: 7500,
      bySource: {},
      byAgent: {},
      byModel: {},
      byUser: {
        'user-1': {
          messages: 20,
          inputTokens: 10000,
          outputTokens: 5000,
          byAgent: { 'a1': { messages: 20, inputTokens: 10000, outputTokens: 5000 } }
        },
        '_anonymous': {
          messages: 10,
          inputTokens: 5000,
          outputTokens: 2500,
          byAgent: { 'a1': { messages: 10, inputTokens: 5000, outputTokens: 2500 } }
        }
      },
      updatedAt: '2026-04-01T00:00:00Z'
    }

    const sumMessages = Object.values(rollup.byUser).reduce((s, u) => s + u.messages, 0)
    assert.equal(sumMessages, rollup.totalMessages, 'tenant messages should equal sum of user messages')

    const sumInput = Object.values(rollup.byUser).reduce((s, u) => s + u.inputTokens, 0)
    assert.equal(sumInput, rollup.totalInputTokens, 'tenant inputTokens should equal sum of user inputTokens')
  })
})
