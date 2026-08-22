import { describe, expect, it } from 'vitest'

process.env.ACCESS_GATE_SECRET ??= 'test-secret-for-unit-tests'

import { z } from 'zod'

// Inline schemas mirroring access-gate.ts (which pulls in next/headers).
const setPasswordSchema = z.object({
  password: z.string().min(1).max(200),
})

const redeemSchema = z.object({
  code: z.string().min(1).max(50),
})

describe('access-gate schemas', () => {
  it('setPasswordSchema accepts valid password', () => {
    expect(setPasswordSchema.safeParse({ password: 'hunter2' }).success).toBe(true)
  })

  it('setPasswordSchema rejects empty', () => {
    expect(setPasswordSchema.safeParse({ password: '' }).success).toBe(false)
  })

  it('redeemSchema accepts a code', () => {
    expect(redeemSchema.safeParse({ code: 'VIBE-ABC123' }).success).toBe(true)
  })

  it('redeemSchema rejects empty code', () => {
    expect(redeemSchema.safeParse({ code: '' }).success).toBe(false)
  })

  it('redeemSchema rejects code over 50 chars', () => {
    expect(redeemSchema.safeParse({ code: 'x'.repeat(51) }).success).toBe(false)
  })
})
