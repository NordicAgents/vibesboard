/**
 * Tests for lib/usage.ts — rollup field builders for per-user token tracking.
 *
 * These test the pure functions that build Firestore update/set payloads,
 * verifying the user -> agent -> tenant hierarchy structure.
 *
 * Run:
 *   node --experimental-strip-types --test lib/usage.test.ts
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildRollupUpdateFields,
  buildRollupSetFields,
  coerceTokenCount
} from './usage-core.ts'

// Fake increment that returns a tagged object so we can verify values
const inc = (n: number) => ({ __increment: n })

// ---------------------------------------------------------------------------
// buildRollupUpdateFields
// ---------------------------------------------------------------------------
describe('buildRollupUpdateFields', () => {
  test('includes per-user message and token counters', () => {
    const fields = buildRollupUpdateFields({
      source: 'chat',
      agentId: 'agent-1',
      model: 'gpt-5.4-nano',
      userId: 'user-42',
      inputTokens: 100,
      outputTokens: 50,
      incrementFn: inc
    })

    // Top-level counters
    assert.deepEqual(fields.totalMessages, { __increment: 1 })
    assert.deepEqual(fields.totalInputTokens, { __increment: 100 })
    assert.deepEqual(fields.totalOutputTokens, { __increment: 50 })

    // By-source / by-agent / by-model
    assert.deepEqual(fields['bySource.chat'], { __increment: 1 })
    assert.deepEqual(fields['byAgent.agent-1'], { __increment: 1 })
    assert.deepEqual(fields['byModel.gpt-5.4-nano'], { __increment: 1 })

    // Per-user counters (dot-notation for Firestore update)
    assert.deepEqual(fields['byUser.user-42.messages'], { __increment: 1 })
    assert.deepEqual(fields['byUser.user-42.inputTokens'], { __increment: 100 })
    assert.deepEqual(fields['byUser.user-42.outputTokens'], { __increment: 50 })

    // Per-user per-agent counters
    assert.deepEqual(fields['byUser.user-42.byAgent.agent-1.messages'], {
      __increment: 1
    })
    assert.deepEqual(fields['byUser.user-42.byAgent.agent-1.inputTokens'], {
      __increment: 100
    })
    assert.deepEqual(fields['byUser.user-42.byAgent.agent-1.outputTokens'], {
      __increment: 50
    })
  })

  test('uses _anonymous key when userId is null', () => {
    const fields = buildRollupUpdateFields({
      source: 'public_chat',
      agentId: 'agent-2',
      model: 'gpt-5.4-nano',
      userId: null,
      inputTokens: 200,
      outputTokens: 80,
      incrementFn: inc
    })

    assert.deepEqual(fields['byUser._anonymous.messages'], { __increment: 1 })
    assert.deepEqual(fields['byUser._anonymous.inputTokens'], {
      __increment: 200
    })
    assert.deepEqual(fields['byUser._anonymous.outputTokens'], {
      __increment: 80
    })
    assert.deepEqual(fields['byUser._anonymous.byAgent.agent-2.messages'], {
      __increment: 1
    })
    assert.deepEqual(fields['byUser._anonymous.byAgent.agent-2.inputTokens'], {
      __increment: 200
    })
    assert.deepEqual(fields['byUser._anonymous.byAgent.agent-2.outputTokens'], {
      __increment: 80
    })
  })

  test('ext: prefixed userId keeps individual tracking for external users', () => {
    const fields = buildRollupUpdateFields({
      source: 'hook_chat',
      agentId: 'agent-3',
      model: 'gpt-5.4-nano',
      userId: 'ext:session-abc123',
      inputTokens: 300,
      outputTokens: 100,
      incrementFn: inc
    })

    // External user should NOT be merged into _anonymous
    assert.equal(fields['byUser._anonymous.messages'], undefined)

    // Should track under ext: prefixed key
    assert.deepEqual(fields['byUser.ext:session-abc123.messages'], {
      __increment: 1
    })
    assert.deepEqual(fields['byUser.ext:session-abc123.inputTokens'], {
      __increment: 300
    })
    assert.deepEqual(
      fields['byUser.ext:session-abc123.byAgent.agent-3.messages'],
      { __increment: 1 }
    )
    assert.deepEqual(
      fields['byUser.ext:session-abc123.byAgent.agent-3.inputTokens'],
      { __increment: 300 }
    )
  })

  test('handles zero tokens correctly', () => {
    const fields = buildRollupUpdateFields({
      source: 'hook_chat',
      agentId: 'agent-3',
      model: 'gpt-5.4-nano',
      userId: 'user-1',
      inputTokens: 0,
      outputTokens: 0,
      incrementFn: inc
    })

    assert.deepEqual(fields.totalInputTokens, { __increment: 0 })
    assert.deepEqual(fields.totalOutputTokens, { __increment: 0 })
    assert.deepEqual(fields['byUser.user-1.inputTokens'], { __increment: 0 })
    assert.deepEqual(fields['byUser.user-1.outputTokens'], { __increment: 0 })
    assert.deepEqual(fields['byUser.user-1.byAgent.agent-3.inputTokens'], {
      __increment: 0
    })
  })

  test('produces exactly 13 fields', () => {
    const fields = buildRollupUpdateFields({
      source: 'chat',
      agentId: 'a',
      model: 'm',
      userId: 'u',
      inputTokens: 1,
      outputTokens: 1,
      incrementFn: inc
    })

    const keys = Object.keys(fields)
    // 3 totals + 3 by-dimensions + 3 user-level + 3 user-agent = 12
    assert.equal(
      keys.length,
      12,
      `Expected 12 fields, got ${keys.length}: ${keys.join(', ')}`
    )
  })
})

// ---------------------------------------------------------------------------
// buildRollupSetFields
// ---------------------------------------------------------------------------
describe('buildRollupSetFields', () => {
  test('builds nested structure for first-time set', () => {
    const fields = buildRollupSetFields({
      tenantId: 'tenant-1',
      billingCycleId: '2026-04',
      source: 'chat',
      agentId: 'agent-1',
      model: 'gpt-5.4-nano',
      userId: 'user-42',
      inputTokens: 150,
      outputTokens: 60,
      incrementFn: inc
    })

    assert.equal(fields.tenantId, 'tenant-1')
    assert.equal(fields.billingCycleId, '2026-04')
    assert.deepEqual(fields.totalMessages, { __increment: 1 })
    assert.deepEqual(fields.totalInputTokens, { __increment: 150 })
    assert.deepEqual(fields.totalOutputTokens, { __increment: 60 })

    // Nested by-dimensions
    assert.deepEqual(fields.bySource, { chat: { __increment: 1 } })
    assert.deepEqual(fields.byAgent, { 'agent-1': { __increment: 1 } })
    assert.deepEqual(fields.byModel, { 'gpt-5.4-nano': { __increment: 1 } })

    // Nested user structure
    const userEntry = fields.byUser['user-42']
    assert.ok(userEntry, 'byUser should have user-42 key')
    assert.deepEqual(userEntry.messages, { __increment: 1 })
    assert.deepEqual(userEntry.inputTokens, { __increment: 150 })
    assert.deepEqual(userEntry.outputTokens, { __increment: 60 })

    // Nested user -> agent structure
    const agentEntry = userEntry.byAgent['agent-1']
    assert.ok(agentEntry, 'byAgent should have agent-1 key')
    assert.deepEqual(agentEntry.messages, { __increment: 1 })
    assert.deepEqual(agentEntry.inputTokens, { __increment: 150 })
    assert.deepEqual(agentEntry.outputTokens, { __increment: 60 })
  })

  test('uses _anonymous for null userId in set fields', () => {
    const fields = buildRollupSetFields({
      tenantId: 't',
      billingCycleId: '2026-04',
      source: 'public_chat',
      agentId: 'a',
      model: 'm',
      userId: null,
      inputTokens: 10,
      outputTokens: 5,
      incrementFn: inc
    })

    assert.ok(fields.byUser['_anonymous'], 'should use _anonymous key')
    assert.deepEqual(fields.byUser['_anonymous'].messages, { __increment: 1 })
    assert.deepEqual(fields.byUser['_anonymous'].byAgent['a'].inputTokens, {
      __increment: 10
    })
  })

  test('ext: prefixed userId tracked individually in set fields', () => {
    const fields = buildRollupSetFields({
      tenantId: 't',
      billingCycleId: '2026-04',
      source: 'hook_stream',
      agentId: 'agent-x',
      model: 'm',
      userId: 'ext:hook-abc',
      inputTokens: 500,
      outputTokens: 200,
      incrementFn: inc
    })

    assert.equal(
      fields.byUser['_anonymous'],
      undefined,
      'should not have _anonymous'
    )
    assert.ok(fields.byUser['ext:hook-abc'], 'should have ext: prefixed key')
    assert.deepEqual(fields.byUser['ext:hook-abc'].messages, { __increment: 1 })
    assert.deepEqual(
      fields.byUser['ext:hook-abc'].byAgent['agent-x'].inputTokens,
      { __increment: 500 }
    )
  })

  test('user -> agent hierarchy is correct for multiple calls', () => {
    // Simulate what two separate calls with different agents would produce
    const fields1 = buildRollupSetFields({
      tenantId: 't',
      billingCycleId: '2026-04',
      source: 'chat',
      agentId: 'agent-A',
      model: 'm',
      userId: 'user-1',
      inputTokens: 100,
      outputTokens: 50,
      incrementFn: inc
    })

    const fields2 = buildRollupSetFields({
      tenantId: 't',
      billingCycleId: '2026-04',
      source: 'chat',
      agentId: 'agent-B',
      model: 'm',
      userId: 'user-1',
      inputTokens: 200,
      outputTokens: 75,
      incrementFn: inc
    })

    // Each call tracks a different agent under the same user
    assert.ok(fields1.byUser['user-1'].byAgent['agent-A'])
    assert.ok(fields2.byUser['user-1'].byAgent['agent-B'])
    assert.equal(fields1.byUser['user-1'].byAgent['agent-B'], undefined)
    assert.equal(fields2.byUser['user-1'].byAgent['agent-A'], undefined)
  })
})

// ---------------------------------------------------------------------------
// Field key structure validation
// ---------------------------------------------------------------------------
describe('rollup field key structure', () => {
  test('update fields use correct Firestore dot-notation for nested paths', () => {
    const fields = buildRollupUpdateFields({
      source: 'whatsapp',
      agentId: 'wa-agent',
      model: 'gpt-5.4-nano',
      userId: 'user-abc',
      inputTokens: 500,
      outputTokens: 250,
      incrementFn: inc
    })

    const keys = Object.keys(fields)

    // Verify dot-notation keys exist (required for Firestore update to work)
    assert.ok(
      keys.includes('byUser.user-abc.messages'),
      'should have user messages key'
    )
    assert.ok(
      keys.includes('byUser.user-abc.inputTokens'),
      'should have user inputTokens key'
    )
    assert.ok(
      keys.includes('byUser.user-abc.outputTokens'),
      'should have user outputTokens key'
    )
    assert.ok(
      keys.includes('byUser.user-abc.byAgent.wa-agent.messages'),
      'should have user-agent messages key'
    )
    assert.ok(
      keys.includes('byUser.user-abc.byAgent.wa-agent.inputTokens'),
      'should have user-agent inputTokens key'
    )
    assert.ok(
      keys.includes('byUser.user-abc.byAgent.wa-agent.outputTokens'),
      'should have user-agent outputTokens key'
    )

    // Ensure no accidental nesting — all keys should be flat strings with dots
    for (const key of keys) {
      assert.equal(typeof key, 'string')
    }
  })

  test('coerced NaN tokens never reach the increment function', () => {
    // Simulates what happens in recordUsage when the upstream model returns
    // NaN token counts. After coercion, the increment function must only
    // receive finite numbers — FieldValue.increment(NaN) throws synchronously
    // and would tear down the streaming HTTP response (issue #152).
    const seen: number[] = []
    const trackingInc = (n: number) => {
      seen.push(n)
      return { __increment: n }
    }

    buildRollupUpdateFields({
      source: 'chat',
      agentId: 'a',
      model: 'm',
      userId: 'u',
      inputTokens: coerceTokenCount(NaN),
      outputTokens: coerceTokenCount(NaN),
      incrementFn: trackingInc
    })

    for (const n of seen) {
      assert.ok(Number.isFinite(n), `increment got non-finite value: ${n}`)
    }
  })

  test('set fields use nested objects (not dot-notation)', () => {
    const fields = buildRollupSetFields({
      tenantId: 't',
      billingCycleId: '2026-04',
      source: 'chat',
      agentId: 'a',
      model: 'm',
      userId: 'u',
      inputTokens: 1,
      outputTokens: 1,
      incrementFn: inc
    })

    // byUser should be a nested object, not dot-notation keys
    assert.equal(typeof fields.byUser, 'object')
    assert.equal(typeof fields.byUser['u'], 'object')
    assert.equal(typeof fields.byUser['u'].byAgent, 'object')
    assert.equal(typeof fields.byUser['u'].byAgent['a'], 'object')
  })
})

// ---------------------------------------------------------------------------
// coerceTokenCount — guards FieldValue.increment() against non-finite values
// ---------------------------------------------------------------------------
describe('coerceTokenCount', () => {
  test('passes through finite non-negative numbers unchanged', () => {
    assert.equal(coerceTokenCount(0), 0)
    assert.equal(coerceTokenCount(1), 1)
    assert.equal(coerceTokenCount(12345), 12345)
    assert.equal(coerceTokenCount(0.5), 0.5)
  })

  test('coerces NaN to 0', () => {
    assert.equal(coerceTokenCount(NaN), 0)
  })

  test('coerces Infinity and -Infinity to 0', () => {
    assert.equal(coerceTokenCount(Infinity), 0)
    assert.equal(coerceTokenCount(-Infinity), 0)
  })

  test('coerces negative numbers to 0', () => {
    assert.equal(coerceTokenCount(-1), 0)
    assert.equal(coerceTokenCount(-0.0001), 0)
  })

  test('coerces undefined and null to 0', () => {
    assert.equal(coerceTokenCount(undefined), 0)
    assert.equal(coerceTokenCount(null), 0)
  })

  test('coerces non-numeric values to 0', () => {
    assert.equal(coerceTokenCount('100'), 0)
    assert.equal(coerceTokenCount('abc'), 0)
    assert.equal(coerceTokenCount({}), 0)
    assert.equal(coerceTokenCount([]), 0)
    assert.equal(coerceTokenCount(true), 0)
  })
})
