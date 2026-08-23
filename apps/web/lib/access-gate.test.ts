// HIGH priority: password hashing/verification is a security boundary for
// agent access gating. hashPassword/verifyPassword are re-exported by
// @/lib/access-gate from @vibesboard/ai/access-gate-crypto, which requires
// ACCESS_GATE_SECRET — set it before importing the module under test.
//
// Password hashes use a versioned random salt plus the process secret.
process.env.ACCESS_GATE_SECRET ??= 'test-access-gate-secret'

import { describe, it, expect } from 'vitest'
import { verifyPassword, hashPassword } from './access-gate.ts'

describe('hashPassword / verifyPassword', () => {
  it('round-trips a correct password', () => {
    const stored = hashPassword('hunter2')
    expect(verifyPassword('hunter2', stored)).toBe(true)
  })

  it('produces a memory-hard versioned salt and digest', () => {
    const stored = hashPassword('hunter2')
    expect(stored).toMatch(/^v3\$[0-9a-f]{32}\$[0-9a-f]{64}$/)
  })

  it('does not correlate identical passwords across agents', () => {
    expect(hashPassword('hunter2')).not.toBe(hashPassword('hunter2'))
  })

  it('produces different digests for different passwords', () => {
    expect(hashPassword('hunter2')).not.toBe(hashPassword('hunter3'))
  })

  it('rejects a wrong password', () => {
    const stored = hashPassword('hunter2')
    expect(verifyPassword('wrong', stored)).toBe(false)
  })

  it('rejects when the password is empty', () => {
    const stored = hashPassword('hunter2')
    expect(verifyPassword('', stored)).toBe(false)
  })

  it('rejects a malformed stored value of the wrong length (no throw)', () => {
    expect(verifyPassword('hunter2', 'not-a-valid-hash')).toBe(false)
  })

  it('rejects an empty stored value', () => {
    expect(verifyPassword('hunter2', '')).toBe(false)
  })

  it('rejects a tampered digest of the correct length', () => {
    // Flip the first hex nibble of a real digest while keeping it 64 chars.
    const stored = hashPassword('hunter2')
    const flipped = (stored[0] === '0' ? '1' : '0') + stored.slice(1)
    expect(verifyPassword('hunter2', flipped)).toBe(false)
  })
})
