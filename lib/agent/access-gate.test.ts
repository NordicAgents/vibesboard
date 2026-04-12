import test, { describe } from 'node:test'
import assert from 'node:assert/strict'

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
  test('returns the secret when ACCESS_GATE_SECRET is set', () => {
    assert.equal(getSecret(), 'test-secret-for-unit-tests')
  })

  test('throws when ACCESS_GATE_SECRET is not set', () => {
    const original = process.env.ACCESS_GATE_SECRET
    delete process.env.ACCESS_GATE_SECRET
    try {
      assert.throws(() => getSecret(), {
        message: /ACCESS_GATE_SECRET/
      })
    } finally {
      process.env.ACCESS_GATE_SECRET = original
    }
  })
})

describe('hashPassword', () => {
  test('produces consistent hex output for same input', () => {
    const hash1 = hashPassword('mypassword')
    const hash2 = hashPassword('mypassword')
    assert.equal(hash1, hash2)
    // HMAC-SHA256 produces 64 hex characters
    assert.match(hash1, /^[0-9a-f]{64}$/)
  })

  test('produces different hashes for different inputs', () => {
    const hash1 = hashPassword('password1')
    const hash2 = hashPassword('password2')
    assert.notEqual(hash1, hash2)
  })

  test('throws when ACCESS_GATE_SECRET is not set', () => {
    const original = process.env.ACCESS_GATE_SECRET
    delete process.env.ACCESS_GATE_SECRET
    try {
      assert.throws(() => hashPassword('test'), {
        message: /ACCESS_GATE_SECRET/
      })
    } finally {
      process.env.ACCESS_GATE_SECRET = original
    }
  })
})

describe('verifyPassword', () => {
  test('returns true for matching password', () => {
    const hash = hashPassword('correct-password')
    assert.equal(verifyPassword('correct-password', hash), true)
  })

  test('returns false for wrong password', () => {
    const hash = hashPassword('correct-password')
    assert.equal(verifyPassword('wrong-password', hash), false)
  })

  test('returns false for different-length hash', () => {
    assert.equal(verifyPassword('anything', 'short'), false)
  })

  test('returns false for empty hash', () => {
    assert.equal(verifyPassword('anything', ''), false)
  })

  test('returns false for tampered hash (single char difference)', () => {
    const hash = hashPassword('mypassword')
    const lastChar = hash[hash.length - 1]
    const tampered = hash.slice(0, -1) + (lastChar === '0' ? '1' : '0')
    assert.equal(verifyPassword('mypassword', tampered), false)
  })
})

describe('signToken / verifyToken', () => {
  test('verifyToken accepts a token signed for the same agentId', () => {
    const token = signToken('agent-123')
    assert.equal(verifyToken(token, 'agent-123'), true)
  })

  test('verifyToken rejects a token signed for a different agentId', () => {
    const token = signToken('agent-123')
    assert.equal(verifyToken(token, 'agent-456'), false)
  })

  test('verifyToken rejects a tampered token', () => {
    const token = signToken('agent-123')
    const tampered = token.slice(0, -1) + (token[token.length - 1] === '0' ? '1' : '0')
    assert.equal(verifyToken(tampered, 'agent-123'), false)
  })

  test('verifyToken rejects garbage input', () => {
    assert.equal(verifyToken('', 'agent-123'), false)
    assert.equal(verifyToken('no-dot-separator', 'agent-123'), false)
    assert.equal(verifyToken('bad.sig', 'agent-123'), false)
  })

  test('token format is base64.hex', () => {
    const token = signToken('agent-123')
    const [b64, sig] = token.split('.')
    assert.ok(b64.length > 0)
    assert.match(sig, /^[0-9a-f]{64}$/)
    // Payload should be valid JSON with agentId and ts
    const payload = JSON.parse(Buffer.from(b64, 'base64').toString())
    assert.equal(payload.agentId, 'agent-123')
    assert.equal(typeof payload.ts, 'number')
  })
})

describe('generateCode', () => {
  test('produces VIBE- prefixed code with 6 characters', () => {
    const code = generateCode()
    assert.match(code, /^VIBE-[A-Z2-9]{6}$/)
  })

  test('excludes ambiguous characters I, O, 0, 1', () => {
    // Generate many codes and check none contain ambiguous chars
    for (let i = 0; i < 50; i++) {
      const code = generateCode().slice(5) // remove VIBE- prefix
      assert.doesNotMatch(code, /[IO01]/)
    }
  })

  test('produces unique codes', () => {
    const codes = new Set<string>()
    for (let i = 0; i < 20; i++) {
      codes.add(generateCode())
    }
    // With 6 random chars from 32-char alphabet, collisions in 20 tries are near-impossible
    assert.equal(codes.size, 20)
  })
})

describe('MAX_STORED_REDEMPTIONS', () => {
  test('is a reasonable cap', () => {
    assert.equal(typeof MAX_STORED_REDEMPTIONS, 'number')
    assert.ok(MAX_STORED_REDEMPTIONS > 0)
    assert.ok(MAX_STORED_REDEMPTIONS <= 1000)
  })
})
