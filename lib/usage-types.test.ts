/**
 * Tests for the UsageRollupDocument type hierarchy.
 *
 * Verifies that the byUser field structure supports the
 * user -> agent -> tenant breakdown pattern, including
 * ext: prefixed external users for individual anonymous tracking.
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
  test('byUser supports authenticated user -> agent -> tenant structure', () => {
    const rollup: UsageRollupDocument = {
      tenantId: 'tenant-1',
      billingCycleId: '2026-04',
      totalMessages: 100,
      totalInputTokens: 50000,
      totalOutputTokens: 25000,
      bySource: { chat: 60, public_chat: 20, hook_chat: 20 },
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
        'ext:session-abc': {
          messages: 10,
          inputTokens: 5000,
          outputTokens: 2500,
          byAgent: {
            'agent-2': { messages: 10, inputTokens: 5000, outputTokens: 2500 }
          }
        },
        'ext:hook-xyz': {
          messages: 10,
          inputTokens: 5000,
          outputTokens: 2500,
          byAgent: {
            'agent-1': { messages: 10, inputTokens: 5000, outputTokens: 2500 }
          }
        }
      },
      updatedAt: '2026-04-01T00:00:00Z'
    }

    // Tenant-level totals
    assert.equal(rollup.totalMessages, 100)
    assert.equal(rollup.totalInputTokens, 50000)

    // Authenticated user breakdown
    const user1 = rollup.byUser['user-1']
    assert.equal(user1.messages, 60)
    assert.equal(user1.inputTokens, 30000)

    // User -> Agent breakdown
    const user1Agent1 = user1.byAgent['agent-1']
    assert.equal(user1Agent1.messages, 40)
    assert.equal(user1Agent1.inputTokens, 20000)
    assert.equal(user1Agent1.outputTokens, 10000)

    // External user (public chat session)
    const extSession = rollup.byUser['ext:session-abc']
    assert.equal(extSession.messages, 10)
    assert.ok(extSession.byAgent['agent-2'], 'external session should have agent-2 usage')
    assert.equal(extSession.byAgent['agent-2'].inputTokens, 5000)

    // External user (hook)
    const extHook = rollup.byUser['ext:hook-xyz']
    assert.equal(extHook.messages, 10)
    assert.ok(extHook.byAgent['agent-1'], 'external hook should have agent-1 usage')
  })

  test('ext: prefixed users are individually tracked, not merged', () => {
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
        'ext:session-aaa': {
          messages: 10,
          inputTokens: 5000,
          outputTokens: 2500,
          byAgent: { 'agent-1': { messages: 10, inputTokens: 5000, outputTokens: 2500 } }
        },
        'ext:session-bbb': {
          messages: 10,
          inputTokens: 5000,
          outputTokens: 2500,
          byAgent: { 'agent-1': { messages: 10, inputTokens: 5000, outputTokens: 2500 } }
        },
        'ext:hook-ccc': {
          messages: 10,
          inputTokens: 5000,
          outputTokens: 2500,
          byAgent: { 'agent-2': { messages: 10, inputTokens: 5000, outputTokens: 2500 } }
        }
      },
      updatedAt: '2026-04-01T00:00:00Z'
    }

    // Three separate external users, not merged
    const extKeys = Object.keys(rollup.byUser)
    assert.equal(extKeys.length, 3)
    assert.ok(extKeys.includes('ext:session-aaa'))
    assert.ok(extKeys.includes('ext:session-bbb'))
    assert.ok(extKeys.includes('ext:hook-ccc'))

    // Each has its own independent counters
    assert.equal(rollup.byUser['ext:session-aaa'].messages, 10)
    assert.equal(rollup.byUser['ext:session-bbb'].messages, 10)
    assert.equal(rollup.byUser['ext:hook-ccc'].messages, 10)

    // Different agents for different external users
    assert.ok(rollup.byUser['ext:session-aaa'].byAgent['agent-1'])
    assert.ok(rollup.byUser['ext:hook-ccc'].byAgent['agent-2'])
    assert.equal(rollup.byUser['ext:hook-ccc'].byAgent['agent-1'], undefined)
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

    const sumMessages = Object.values(user.byAgent).reduce((s, a) => s + a.messages, 0)
    assert.equal(sumMessages, user.messages, 'user messages should equal sum of agent messages')

    const sumInput = Object.values(user.byAgent).reduce((s, a) => s + a.inputTokens, 0)
    assert.equal(sumInput, user.inputTokens, 'user inputTokens should equal sum of agent inputTokens')

    const sumOutput = Object.values(user.byAgent).reduce((s, a) => s + a.outputTokens, 0)
    assert.equal(sumOutput, user.outputTokens, 'user outputTokens should equal sum of agent outputTokens')
  })

  test('tenant totals can be derived by summing all user usage (auth + ext)', () => {
    const rollup: UsageRollupDocument = {
      tenantId: 't',
      billingCycleId: '2026-04',
      totalMessages: 40,
      totalInputTokens: 20000,
      totalOutputTokens: 10000,
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
        'ext:session-abc': {
          messages: 10,
          inputTokens: 5000,
          outputTokens: 2500,
          byAgent: { 'a1': { messages: 10, inputTokens: 5000, outputTokens: 2500 } }
        },
        'ext:hook-def': {
          messages: 10,
          inputTokens: 5000,
          outputTokens: 2500,
          byAgent: { 'a2': { messages: 10, inputTokens: 5000, outputTokens: 2500 } }
        }
      },
      updatedAt: '2026-04-01T00:00:00Z'
    }

    const sumMessages = Object.values(rollup.byUser).reduce((s, u) => s + u.messages, 0)
    assert.equal(sumMessages, rollup.totalMessages, 'tenant messages should equal sum of all user messages')

    const sumInput = Object.values(rollup.byUser).reduce((s, u) => s + u.inputTokens, 0)
    assert.equal(sumInput, rollup.totalInputTokens, 'tenant inputTokens should equal sum of all user inputTokens')

    const sumOutput = Object.values(rollup.byUser).reduce((s, u) => s + u.outputTokens, 0)
    assert.equal(sumOutput, rollup.totalOutputTokens, 'tenant outputTokens should equal sum of all user outputTokens')
  })

  test('each external user can be traced back to specific agents and tenant', () => {
    const rollup: UsageRollupDocument = {
      tenantId: 'tenant-acme',
      billingCycleId: '2026-04',
      totalMessages: 25,
      totalInputTokens: 12500,
      totalOutputTokens: 6250,
      bySource: { public_chat: 15, hook_chat: 10 },
      byAgent: { 'bot-sales': 15, 'bot-support': 10 },
      byModel: { 'gpt-5.4-nano': 25 },
      byUser: {
        'ext:visitor-001': {
          messages: 5,
          inputTokens: 2500,
          outputTokens: 1250,
          byAgent: {
            'bot-sales': { messages: 3, inputTokens: 1500, outputTokens: 750 },
            'bot-support': { messages: 2, inputTokens: 1000, outputTokens: 500 }
          }
        },
        'ext:visitor-002': {
          messages: 10,
          inputTokens: 5000,
          outputTokens: 2500,
          byAgent: {
            'bot-sales': { messages: 10, inputTokens: 5000, outputTokens: 2500 }
          }
        },
        'ext:api-client-X': {
          messages: 10,
          inputTokens: 5000,
          outputTokens: 2500,
          byAgent: {
            'bot-support': { messages: 8, inputTokens: 4000, outputTokens: 2000 },
            'bot-sales': { messages: 2, inputTokens: 1000, outputTokens: 500 }
          }
        }
      },
      updatedAt: '2026-04-01T00:00:00Z'
    }

    // Tenant is identifiable
    assert.equal(rollup.tenantId, 'tenant-acme')

    // Each external user is individually identifiable
    const visitor1 = rollup.byUser['ext:visitor-001']
    assert.equal(visitor1.messages, 5)

    // Can see which agents each external user consumed
    assert.equal(Object.keys(visitor1.byAgent).length, 2, 'visitor-001 used 2 agents')
    assert.equal(visitor1.byAgent['bot-sales'].messages, 3)
    assert.equal(visitor1.byAgent['bot-support'].messages, 2)

    // visitor-002 only used one agent
    const visitor2 = rollup.byUser['ext:visitor-002']
    assert.equal(Object.keys(visitor2.byAgent).length, 1)
    assert.equal(visitor2.byAgent['bot-sales'].messages, 10)

    // API client used two agents with different distribution
    const apiClient = rollup.byUser['ext:api-client-X']
    assert.equal(apiClient.byAgent['bot-support'].messages, 8)
    assert.equal(apiClient.byAgent['bot-sales'].messages, 2)
  })
})
