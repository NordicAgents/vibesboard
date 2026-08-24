import { describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'

// Set the required env var before importing the module
process.env.ACCESS_GATE_SECRET = 'test-secret-for-unit-tests'

import {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  generateCode,
  getSecret,
  MAX_STORED_REDEMPTIONS
} from './access-gate-crypto.ts'

describe('getSecret', () => {
  it('returns the secret when ACCESS_GATE_SECRET is set', () => {
    expect(getSecret()).toBe('test-secret-for-unit-tests')
  })

  it('throws when ACCESS_GATE_SECRET is not set', () => {
    const original = process.env.ACCESS_GATE_SECRET
    delete process.env.ACCESS_GATE_SECRET
    try {
      expect(() => getSecret()).toThrow(/ACCESS_GATE_SECRET/)
    } finally {
      process.env.ACCESS_GATE_SECRET = original
    }
  })
})

describe('hashPassword', () => {
  it('is asynchronous so memory-hard derivation does not block request handling', async () => {
    const pending = hashPassword('mypassword')
    expect(pending).toBeInstanceOf(Promise)
    await pending
  })

  it('uses a memory-hard v3 digest and a different salt for the same password', async () => {
    const hash1 = await hashPassword('mypassword')
    const hash2 = await hashPassword('mypassword')
    expect(hash1).not.toBe(hash2)
    expect(hash1).toMatch(/^v3\$[0-9a-f]{32}\$[0-9a-f]{64}$/)
  })

  it('produces different hashes for different inputs', async () => {
    const hash1 = await hashPassword('password1')
    const hash2 = await hashPassword('password2')
    expect(hash1).not.toBe(hash2)
  })

  it('throws when ACCESS_GATE_SECRET is not set', async () => {
    const original = process.env.ACCESS_GATE_SECRET
    delete process.env.ACCESS_GATE_SECRET
    try {
      await expect(hashPassword('test')).rejects.toThrow(/ACCESS_GATE_SECRET/)
    } finally {
      process.env.ACCESS_GATE_SECRET = original
    }
  })
})

describe('verifyPassword', () => {
  it('is asynchronous so verification does not block request handling', async () => {
    const pending = verifyPassword('anything', 'short')
    expect(pending).toBeInstanceOf(Promise)
    await pending
  })

  it('returns true for matching password', async () => {
    const hash = await hashPassword('correct-password')
    await expect(verifyPassword('correct-password', hash)).resolves.toBe(true)
  })

  it('returns false for wrong password', async () => {
    const hash = await hashPassword('correct-password')
    await expect(verifyPassword('wrong-password', hash)).resolves.toBe(false)
  })

  it('returns false for different-length hash', async () => {
    await expect(verifyPassword('anything', 'short')).resolves.toBe(false)
  })

  it('returns false for empty hash', async () => {
    await expect(verifyPassword('anything', '')).resolves.toBe(false)
  })

  it('returns false for tampered hash (single char difference)', async () => {
    const hash = await hashPassword('mypassword')
    const lastChar = hash[hash.length - 1]
    const tampered = hash.slice(0, -1) + (lastChar === '0' ? '1' : '0')
    await expect(verifyPassword('mypassword', tampered)).resolves.toBe(false)
  })

  it('verifies legacy unsalted hashes during migration', async () => {
    const legacy = createHmac('sha256', getSecret())
      .update('legacy-password')
      .digest('hex')
    await expect(verifyPassword('legacy-password', legacy)).resolves.toBe(true)
    await expect(verifyPassword('wrong-password', legacy)).resolves.toBe(false)
  })

  it('verifies versioned v2 HMAC hashes during migration', async () => {
    const salt = '0123456789abcdef0123456789abcdef'
    const digest = createHmac('sha256', getSecret())
      .update(`v2:${salt}:`)
      .update('legacy-v2-password')
      .digest('hex')
    const legacy = `v2$${salt}$${digest}`

    await expect(
      verifyPassword('legacy-v2-password', legacy)
    ).resolves.toBe(true)
    await expect(verifyPassword('wrong-password', legacy)).resolves.toBe(false)
  })
})

describe('signToken / verifyToken', () => {
  it('verifyToken accepts a token signed for the same agentId', () => {
    const token = signToken('agent-123')
    expect(verifyToken(token, 'agent-123')).toBe(true)
  })

  it('verifyToken rejects a token signed for a different agentId', () => {
    const token = signToken('agent-123')
    expect(verifyToken(token, 'agent-456')).toBe(false)
  })

  it('verifyToken rejects a tampered token', () => {
    const token = signToken('agent-123')
    const tampered =
      token.slice(0, -1) + (token[token.length - 1] === '0' ? '1' : '0')
    expect(verifyToken(tampered, 'agent-123')).toBe(false)
  })

  it('verifyToken rejects garbage input', () => {
    expect(verifyToken('', 'agent-123')).toBe(false)
    expect(verifyToken('no-dot-separator', 'agent-123')).toBe(false)
    expect(verifyToken('bad.sig', 'agent-123')).toBe(false)
  })

  it('token format is base64.hex', () => {
    const token = signToken('agent-123')
    const [b64, sig] = token.split('.')
    expect(b64.length > 0).toBe(true)
    expect(sig).toMatch(/^[0-9a-f]{64}$/)
    // Payload should be valid JSON with agentId and ts
    const payload = JSON.parse(Buffer.from(b64, 'base64').toString())
    expect(payload.agentId).toBe('agent-123')
    expect(typeof payload.ts).toBe('number')
  })

  it('verifyToken rejects a token older than the TTL', () => {
    // Re-sign with an old issue time, then re-HMAC so the signature is valid
    // but the embedded timestamp is stale.
    const { createHmac } = require('crypto') as typeof import('crypto')
    const secret = process.env.ACCESS_GATE_SECRET as string
    const stale = JSON.stringify({
      agentId: 'agent-123',
      ts: Date.now() - 24 * 60 * 60 * 1000 // 24h ago, past the 12h default
    })
    const sig = createHmac('sha256', secret).update(stale).digest('hex')
    const token = Buffer.from(stale).toString('base64') + '.' + sig
    expect(verifyToken(token, 'agent-123')).toBe(false)
  })

  it('verifyToken rejects a token with a future timestamp', () => {
    const { createHmac } = require('crypto') as typeof import('crypto')
    const secret = process.env.ACCESS_GATE_SECRET as string
    const future = JSON.stringify({
      agentId: 'agent-123',
      ts: Date.now() + 60 * 60 * 1000
    })
    const sig = createHmac('sha256', secret).update(future).digest('hex')
    const token = Buffer.from(future).toString('base64') + '.' + sig
    expect(verifyToken(token, 'agent-123')).toBe(false)
  })
})

describe('generateCode', () => {
  it('produces VIBE- prefixed code with 6 characters', () => {
    const code = generateCode()
    expect(code).toMatch(/^VIBE-[A-Z2-9]{6}$/)
  })

  it('excludes ambiguous characters I, O, 0, 1', () => {
    // Generate many codes and check none contain ambiguous chars
    for (let i = 0; i < 50; i++) {
      const code = generateCode().slice(5) // remove VIBE- prefix
      expect(code).not.toMatch(/[IO01]/)
    }
  })

  it('produces unique codes', () => {
    const codes = new Set<string>()
    for (let i = 0; i < 20; i++) {
      codes.add(generateCode())
    }
    // With 6 random chars from 32-char alphabet, collisions in 20 tries are near-impossible
    expect(codes.size).toBe(20)
  })
})

describe('MAX_STORED_REDEMPTIONS', () => {
  it('is a reasonable cap', () => {
    expect(typeof MAX_STORED_REDEMPTIONS).toBe('number')
    expect(MAX_STORED_REDEMPTIONS > 0).toBe(true)
    expect(MAX_STORED_REDEMPTIONS <= 1000).toBe(true)
  })
})
