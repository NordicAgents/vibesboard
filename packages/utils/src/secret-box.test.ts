import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import CryptoJS from 'crypto-js'
import {
  sealSecret,
  unsealSecret,
  isModernToken,
  _resetKeyCacheForTests
} from './secret-box.ts'

const ENV_KEYS = ['ENCRYPTION_KEY', 'ENCRYPTION_KEYS_OLD'] as const
let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = {}
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  _resetKeyCacheForTests()
  process.env.ENCRYPTION_KEY = 'current-master-key-aaaaaaaaaaaaaaaa'
  delete process.env.ENCRYPTION_KEYS_OLD
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]!
  }
  _resetKeyCacheForTests()
})

describe('sealSecret / unsealSecret', () => {
  it('round-trips a secret through GCM', () => {
    const token = sealSecret('super-secret-oauth-token')
    expect(isModernToken(token)).toBe(true)
    expect(token.split(':')).toHaveLength(5)
    expect(unsealSecret(token)).toBe('super-secret-oauth-token')
  })

  it('produces a fresh IV each time (non-deterministic ciphertext)', () => {
    const a = sealSecret('same')
    const b = sealSecret('same')
    expect(a).not.toBe(b)
    expect(unsealSecret(a)).toBe('same')
    expect(unsealSecret(b)).toBe('same')
  })

  it('handles unicode and empty strings', () => {
    for (const s of ['', 'plain', 'ключ-🔐-key', 'a'.repeat(4096)]) {
      expect(unsealSecret(sealSecret(s))).toBe(s)
    }
  })

  it('rejects a tampered ciphertext (auth tag fails)', () => {
    const token = sealSecret('do-not-tamper')
    const parts = token.split(':')
    // Flip a byte in the ciphertext segment.
    const ct = Buffer.from(parts[4], 'base64')
    ct[0] = ct[0] ^ 0xff
    parts[4] = ct.toString('base64')
    expect(() => unsealSecret(parts.join(':'))).toThrow()
  })

  it('fails to decrypt when the key changes with no old key configured', () => {
    const token = sealSecret('secret')
    _resetKeyCacheForTests()
    process.env.ENCRYPTION_KEY = 'a-totally-different-key-bbbbbbbbbbbb'
    expect(() => unsealSecret(token)).toThrow()
  })
})

describe('key rotation', () => {
  it('decrypts a value sealed under a now-retired key', () => {
    // Seal with the "old" key.
    process.env.ENCRYPTION_KEY = 'old-key-1111111111111111'
    _resetKeyCacheForTests()
    const token = sealSecret('rotate-me')

    // Rotate: new current key, old key moved to ENCRYPTION_KEYS_OLD.
    process.env.ENCRYPTION_KEY = 'new-key-2222222222222222'
    process.env.ENCRYPTION_KEYS_OLD = 'old-key-1111111111111111'
    _resetKeyCacheForTests()

    // The old token still opens...
    expect(unsealSecret(token)).toBe('rotate-me')
    // ...and new writes use the new key.
    const fresh = sealSecret('fresh-value')
    delete process.env.ENCRYPTION_KEYS_OLD
    _resetKeyCacheForTests()
    expect(unsealSecret(fresh)).toBe('fresh-value')
  })

  it('supports multiple retired keys', () => {
    process.env.ENCRYPTION_KEY = 'k-a-aaaaaaaaaaaaaaaaaaaaaa'
    _resetKeyCacheForTests()
    const tokenA = sealSecret('value-a')

    process.env.ENCRYPTION_KEY = 'k-b-bbbbbbbbbbbbbbbbbbbbbb'
    _resetKeyCacheForTests()
    const tokenB = sealSecret('value-b')

    process.env.ENCRYPTION_KEY = 'k-c-cccccccccccccccccccccc'
    process.env.ENCRYPTION_KEYS_OLD =
      'k-a-aaaaaaaaaaaaaaaaaaaaaa, k-b-bbbbbbbbbbbbbbbbbbbbbb'
    _resetKeyCacheForTests()

    expect(unsealSecret(tokenA)).toBe('value-a')
    expect(unsealSecret(tokenB)).toBe('value-b')
  })
})

describe('legacy CryptoJS compatibility', () => {
  it('transparently decrypts an old CryptoJS-encrypted value', () => {
    // Reproduce exactly what the old EncryptedDbCredStore/encryptToken wrote.
    const legacy = CryptoJS.AES.encrypt(
      'legacy-oauth-token',
      process.env.ENCRYPTION_KEY as string
    ).toString()
    expect(isModernToken(legacy)).toBe(false)
    expect(unsealSecret(legacy)).toBe('legacy-oauth-token')
  })

  it('decrypts a legacy value under a retired key after rotation', () => {
    const legacy = CryptoJS.AES.encrypt(
      'old-legacy',
      'legacy-key-xxxxxxxxxxxx'
    ).toString()
    process.env.ENCRYPTION_KEY = 'new-key-yyyyyyyyyyyyyyyy'
    process.env.ENCRYPTION_KEYS_OLD = 'legacy-key-xxxxxxxxxxxx'
    _resetKeyCacheForTests()
    expect(unsealSecret(legacy)).toBe('old-legacy')
  })

  it('re-sealing a legacy value yields a modern token', () => {
    const legacy = CryptoJS.AES.encrypt(
      'v',
      process.env.ENCRYPTION_KEY as string
    ).toString()
    const reSealed = sealSecret(unsealSecret(legacy))
    expect(isModernToken(reSealed)).toBe(true)
    expect(unsealSecret(reSealed)).toBe('v')
  })
})

describe('missing key', () => {
  it('throws when ENCRYPTION_KEY is unset', () => {
    delete process.env.ENCRYPTION_KEY
    _resetKeyCacheForTests()
    expect(() => sealSecret('x')).toThrow(/ENCRYPTION_KEY/)
  })
})
