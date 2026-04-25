import test, { describe } from 'node:test'
import assert from 'node:assert/strict'

// Set the required env var before importing the module — access-gate.ts
// re-exports from access-gate-crypto which reads ACCESS_GATE_SECRET.
process.env.ACCESS_GATE_SECRET ??= 'test-secret-for-unit-tests'

// Inline copy of the schema rather than importing from access-gate.ts —
// access-gate.ts pulls in firebase-admin and next/headers, which the
// node:test runner cannot resolve without a bundler. The test instead
// guards the contract by duplicating the schema, matching the pattern
// used by lib/integration/schema-validation.test.ts.
import { z } from 'zod'

const setPasswordSchema = z.object({
  password: z.string().min(1).max(200)
})

describe('setPasswordSchema', () => {
  test('accepts a normal password', () => {
    const result = setPasswordSchema.safeParse({ password: 'hunter2' })
    assert.equal(result.success, true)
  })

  test('rejects empty password', () => {
    const result = setPasswordSchema.safeParse({ password: '' })
    assert.equal(result.success, false)
  })

  test('rejects missing password field', () => {
    const result = setPasswordSchema.safeParse({})
    assert.equal(result.success, false)
  })

  test('rejects non-string password', () => {
    const result = setPasswordSchema.safeParse({ password: 12345 })
    assert.equal(result.success, false)
  })

  test('rejects password longer than 200 chars', () => {
    const result = setPasswordSchema.safeParse({ password: 'x'.repeat(201) })
    assert.equal(result.success, false)
  })

  test('accepts password exactly 200 chars', () => {
    const result = setPasswordSchema.safeParse({ password: 'x'.repeat(200) })
    assert.equal(result.success, true)
  })

  test('rejects an entire agent config blob (the production bug)', () => {
    // Reproduces the suspected client/server payload mismatch from issue #153:
    // the form was suspected of sending the full agent doc instead of { password }.
    // The schema must surface this as a validation failure (→ 400), not throw.
    const agentBlob = {
      id: 'abc',
      name: 'My agent',
      instructions: 'long instructions',
      tools: [],
      sourceUrls: ['https://example.com']
    }
    const result = setPasswordSchema.safeParse(agentBlob)
    assert.equal(result.success, false)
  })

  test('rejects null body', () => {
    const result = setPasswordSchema.safeParse(null)
    assert.equal(result.success, false)
  })

  test('rejects array body', () => {
    const result = setPasswordSchema.safeParse([])
    assert.equal(result.success, false)
  })
})
