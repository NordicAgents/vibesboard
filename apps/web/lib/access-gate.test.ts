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
  it('round-trips a correct password', async () => {
    const stored = await hashPassword('hunter2')
    await expect(verifyPassword('hunter2', stored)).resolves.toBe(true)
  })

  it('produces a memory-hard versioned salt and digest', async () => {
    const stored = await hashPassword('hunter2')
    expect(stored).toMatch(/^v3\$[0-9a-f]{32}\$[0-9a-f]{64}$/)
  })

  it('does not correlate identical passwords across agents', async () => {
    await expect(hashPassword('hunter2')).resolves.not.toBe(
      await hashPassword('hunter2')
    )
  })

  it('produces different digests for different passwords', async () => {
    await expect(hashPassword('hunter2')).resolves.not.toBe(
      await hashPassword('hunter3')
    )
  })

  it('rejects a wrong password', async () => {
    const stored = await hashPassword('hunter2')
    await expect(verifyPassword('wrong', stored)).resolves.toBe(false)
  })

  it('rejects when the password is empty', async () => {
    const stored = await hashPassword('hunter2')
    await expect(verifyPassword('', stored)).resolves.toBe(false)
  })

  it('rejects a malformed stored value of the wrong length (no throw)', async () => {
    await expect(verifyPassword('hunter2', 'not-a-valid-hash')).resolves.toBe(
      false
    )
  })

  it('rejects an empty stored value', async () => {
    await expect(verifyPassword('hunter2', '')).resolves.toBe(false)
  })

  it('rejects a tampered digest of the correct length', async () => {
    // Flip the first hex nibble of a real digest while keeping it 64 chars.
    const stored = await hashPassword('hunter2')
    const flipped = (stored[0] === '0' ? '1' : '0') + stored.slice(1)
    await expect(verifyPassword('hunter2', flipped)).resolves.toBe(false)
  })
})
