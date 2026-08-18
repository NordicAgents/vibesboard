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

  it('always seals with a full 16-byte auth tag', () => {
    const [, , , tagB64] = sealSecret('tag-length').split(':')
    expect(Buffer.from(tagB64, 'base64')).toHaveLength(16)
  })

  it('rejects a truncated auth tag', () => {
    // node accepts 4/8/12..16-byte GCM tags unless authTagLength is pinned.
    // A short tag is far cheaper to forge, so unsealing must refuse one even
    // though the ciphertext and IV are untouched.
    const parts = sealSecret('do-not-truncate').split(':')
    parts[3] = Buffer.from(parts[3], 'base64').subarray(0, 4).toString('base64')
    expect(() => unsealSecret(parts.join(':'))).toThrow()
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

  // Recorded fixture, not a fresh encrypt: CryptoJS salts each ciphertext
  // randomly, and only some salts make a wrong-key decrypt produce invalid
  // UTF-8. Generating one here would reproduce the bug ~2.5% of the time and
  // read as a flake. This exact string encrypts 'old-legacy' under
  // 'legacy-key-xxxxxxxxxxxx' AND throws "Malformed UTF-8 data" when decrypted
  // with 'current-master-key-aaaaaaaaaaaaaaaa', so it pins the failure every run.
  const THROWS_UNDER_CURRENT_KEY = 'U2FsdGVkX1+zbNaZyelsrpCPJtdHo7L1GPOx4tHQqAE='

  it('keeps trying retired keys when the current key throws on a legacy value', () => {
    // The regression: CryptoJS throws on invalid UTF-8 rather than returning
    // '', so the decrypt loop used to abort on the current key and never reach
    // ENCRYPTION_KEYS_OLD. Because the salt is fixed once a value is stored,
    // that is not intermittent in production — the affected rows are lost for
    // good after a rotation.
    process.env.ENCRYPTION_KEYS_OLD = 'legacy-key-xxxxxxxxxxxx'
    _resetKeyCacheForTests()
    expect(unsealSecret(THROWS_UNDER_CURRENT_KEY)).toBe('old-legacy')
  })

  it('still reports its own error when no configured key fits', () => {
    // The catch must not swallow a genuine failure into a silent wrong answer.
    process.env.ENCRYPTION_KEYS_OLD = 'some-other-retired-key-zzzz'
    _resetKeyCacheForTests()
    expect(() => unsealSecret(THROWS_UNDER_CURRENT_KEY)).toThrow(
      /Unable to decrypt legacy token/
    )
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
