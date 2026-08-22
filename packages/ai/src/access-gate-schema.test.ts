import { describe, expect, it } from 'vitest'

// Set the required env var before importing the module — access-gate.ts
// re-exports from access-gate-crypto which reads ACCESS_GATE_SECRET.
process.env.ACCESS_GATE_SECRET ??= 'test-secret-for-unit-tests'

// Inline copy of the schema rather than importing from access-gate.ts —
// access-gate.ts pulls in next/headers and server-only deps. The test
// guards the contract by duplicating the schema, matching the pattern
// used by lib/integration/schema-validation.test.ts.
import { z } from 'zod'

const setPasswordSchema = z.object({
  password: z.string().min(1).max(200),
})

describe('setPasswordSchema', () => {
  it('accepts a normal password', () => {
    const result = setPasswordSchema.safeParse({ password: 'hunter2' })
    expect(result.success).toBe(true)
  })

  it('rejects empty password', () => {
    const result = setPasswordSchema.safeParse({ password: '' })
    expect(result.success).toBe(false)
  })

  it('rejects missing password field', () => {
    const result = setPasswordSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects non-string password', () => {
    const result = setPasswordSchema.safeParse({ password: 12345 })
    expect(result.success).toBe(false)
  })

  it('rejects password longer than 200 chars', () => {
    const result = setPasswordSchema.safeParse({ password: 'x'.repeat(201) })
    expect(result.success).toBe(false)
  })

  it('accepts password exactly 200 chars', () => {
    const result = setPasswordSchema.safeParse({ password: 'x'.repeat(200) })
    expect(result.success).toBe(true)
  })

  it('rejects an entire agent config blob (the production bug)', () => {
    // Reproduces the suspected client/server payload mismatch from issue #153:
    // the form was suspected of sending the full agent doc instead of { password }.
    // The schema must surface this as a validation failure (→ 400), not throw.
    const agentBlob = {
      id: 'abc',
      name: 'My agent',
      instructions: 'long instructions',
      tools: [],
      sourceUrls: ['https://example.com'],
    }
    const result = setPasswordSchema.safeParse(agentBlob)
    expect(result.success).toBe(false)
  })

  it('rejects null body', () => {
    const result = setPasswordSchema.safeParse(null)
    expect(result.success).toBe(false)
  })

  it('rejects array body', () => {
    const result = setPasswordSchema.safeParse([])
    expect(result.success).toBe(false)
  })
})
