import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { EncryptedDbCredStore } from '../cred-store/encrypted-db.ts'

// ---------------------------------------------------------------------------
// Environment setup
// ---------------------------------------------------------------------------
const TEST_KEY = 'test-key-32-characters-long-here'

let originalKey: string | undefined

beforeAll(() => {
  originalKey = process.env.ENCRYPTION_KEY
  process.env.ENCRYPTION_KEY = TEST_KEY
})

afterAll(() => {
  process.env.ENCRYPTION_KEY = originalKey
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('EncryptedDbCredStore', () => {
  const store = new EncryptedDbCredStore()

  // -------------------------------------------------------------------------
  // seal()
  // -------------------------------------------------------------------------
  describe('seal()', () => {
    it('returns a non-empty string', async () => {
      const token = await store.seal('my-secret-api-key')
      expect(typeof token).toBe('string')
      expect(token.length).toBeGreaterThan(0)
    })

    it('returns a value different from the plaintext (ciphertext, not identity)', async () => {
      const plaintext = 'my-secret-api-key'
      const token = await store.seal(plaintext)
      expect(token).not.toBe(plaintext)
    })

    it('produces different ciphertexts for different plaintexts', async () => {
      const token1 = await store.seal('key-one')
      const token2 = await store.seal('key-two')
      expect(token1).not.toBe(token2)
    })

    it('throws when ENCRYPTION_KEY is not set', async () => {
      delete process.env.ENCRYPTION_KEY
      try {
        await expect(store.seal('test')).rejects.toThrow('ENCRYPTION_KEY')
      } finally {
        process.env.ENCRYPTION_KEY = TEST_KEY
      }
    })
  })

  // -------------------------------------------------------------------------
  // unseal()
  // -------------------------------------------------------------------------
  describe('unseal()', () => {
    it('round-trips: unseal(seal(plaintext)) === plaintext', async () => {
      const plaintext = 'super-secret-key-value'
      const token = await store.seal(plaintext)
      const recovered = await store.unseal(token)
      expect(recovered).toBe(plaintext)
    })

    it('round-trips a plaintext containing special characters', async () => {
      const plaintext = 'sk-ant-api03-abc123!@#$%^&*()_+-=[]{}|;\':",./<>?'
      const token = await store.seal(plaintext)
      const recovered = await store.unseal(token)
      expect(recovered).toBe(plaintext)
    })

    it('fails loudly (throws) when decrypted with a wrong key', async () => {
      const plaintext = 'original-secret'
      const token = await store.seal(plaintext)

      // GCM is authenticated: a wrong key fails the auth tag and throws, rather
      // than silently returning '' or garbage the way the old CryptoJS did.
      process.env.ENCRYPTION_KEY = 'wrong-key-32-characters-long-xxx'
      try {
        await expect(store.unseal(token)).rejects.toThrow()
      } finally {
        process.env.ENCRYPTION_KEY = TEST_KEY
      }
    })

    it('transparently decrypts a legacy CryptoJS-sealed value', async () => {
      // Simulate a value written by the previous implementation.
      const CryptoJS = (await import('crypto-js')).default
      const legacy = CryptoJS.AES.encrypt('legacy-secret', TEST_KEY).toString()
      expect(await store.unseal(legacy)).toBe('legacy-secret')
    })

    it('throws when ENCRYPTION_KEY is not set', async () => {
      const token = await store.seal('test-value')
      delete process.env.ENCRYPTION_KEY
      try {
        await expect(store.unseal(token)).rejects.toThrow('ENCRYPTION_KEY')
      } finally {
        process.env.ENCRYPTION_KEY = TEST_KEY
      }
    })
  })

  // -------------------------------------------------------------------------
  // revoke()
  // -------------------------------------------------------------------------
  describe('revoke()', () => {
    it('resolves without error (no-op: token lives in the DB row)', async () => {
      const token = await store.seal('key-to-revoke')
      await expect(store.revoke(token)).resolves.toBeUndefined()
    })

    it('resolves without error when called with an arbitrary token string', async () => {
      await expect(
        store.revoke('some-arbitrary-token')
      ).resolves.toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // Non-determinism / key-dependence
  // -------------------------------------------------------------------------
  describe('non-determinism / key-dependence', () => {
    it('sealing the same plaintext twice produces different ciphertexts (IV randomisation)', async () => {
      const plaintext = 'same-input'
      const token1 = await store.seal(plaintext)
      const token2 = await store.seal(plaintext)
      // AES-GCM uses a random IV per invocation.
      expect(token1).not.toBe(token2)
      // Both still decrypt correctly
      expect(await store.unseal(token1)).toBe(plaintext)
      expect(await store.unseal(token2)).toBe(plaintext)
    })

    it('a token sealed with key A cannot be unsealed with key B', async () => {
      const plaintext = 'cross-key-check'
      process.env.ENCRYPTION_KEY = 'key-a-32-characters-long-padded!'
      const token = await store.seal(plaintext)

      process.env.ENCRYPTION_KEY = 'key-b-32-characters-long-padded!'
      try {
        await expect(store.unseal(token)).rejects.toThrow()
      } finally {
        process.env.ENCRYPTION_KEY = TEST_KEY
      }
    })
  })
})
