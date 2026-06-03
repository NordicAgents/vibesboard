import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash, createCipheriv, randomBytes } from 'node:crypto'
import { decryptToken } from '../accounts.ts'

// IMPORTANT: this test deliberately does NOT `import 'crypto-js'`.
//
// crypto-js is a CommonJS bundle that wires up its AES key-schedule by
// side-effect across several files into shared mutable state. Under Vitest's
// transform, importing crypto-js in a test that also imports the product code
// loads a SECOND crypto-js instance that interferes with the one accounts.ts
// uses; the product copy's AES cipher then has an uninitialised key schedule and
// `decryptToken` throws "Cannot read properties of undefined (reading 'words')".
// With no crypto-js import here, the product's single instance stays intact.
//
// To still exercise the real `decryptToken`, we generate ciphertext with Node's
// built-in crypto in crypto-js's exact default format:
//   base64( "Salted__" + 8-byte-salt + AES-256-CBC ),
// key+IV derived via OpenSSL EVP_BytesToKey (MD5). This is byte-for-byte what
// `CryptoJS.AES.encrypt(text, passphrase)` (and thus encryptToken) produces.

function evpBytesToKey(
  pass: Buffer,
  salt: Buffer,
  keyLen: number,
  ivLen: number,
) {
  let data = Buffer.alloc(0)
  let block = Buffer.alloc(0)
  while (data.length < keyLen + ivLen) {
    block = createHash('md5')
      .update(Buffer.concat([block, pass, salt]))
      .digest()
    data = Buffer.concat([data, block])
  }
  return {
    key: data.subarray(0, keyLen),
    iv: data.subarray(keyLen, keyLen + ivLen),
  }
}

function encrypt(plaintext: string, passphrase: string): string {
  const pass = Buffer.from(passphrase, 'utf8')
  const salt = randomBytes(8)
  const { key, iv } = evpBytesToKey(pass, salt, 32, 16)
  const cipher = createCipheriv('aes-256-cbc', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return Buffer.concat([Buffer.from('Salted__', 'utf8'), salt, ct]).toString(
    'base64',
  )
}

// The harness does NOT set ENCRYPTION_KEY (test/setup/env.ts deliberately
// leaves secrets unset). Without a key, encryptToken/decryptToken throw, and
// CryptoJS.AES with an undefined passphrase crashes on its key schedule
// ("...reading 'words'"). Each crypto test sets its own key and restores it.
const ORIGINAL_KEY = process.env.ENCRYPTION_KEY
const TEST_KEY = 'test-encryption-key-1234567890'

beforeEach(() => {
  process.env.ENCRYPTION_KEY = TEST_KEY
})

afterEach(() => {
  if (ORIGINAL_KEY === undefined) {
    delete process.env.ENCRYPTION_KEY
  } else {
    process.env.ENCRYPTION_KEY = ORIGINAL_KEY
  }
})

// The package encrypts tokens with `CryptoJS.AES.encrypt(token, ENCRYPTION_KEY)`
// (see accounts.ts encryptToken). decryptToken must recover the plaintext from
// that exact ciphertext shape.
describe('token crypto round-trip', () => {
  it('decryptToken recovers a CryptoJS-compatible AES ciphertext', () => {
    const plaintext = 'EAAG-super-secret-page-token'
    const cipher = encrypt(plaintext, process.env.ENCRYPTION_KEY!)
    // Ciphertext must not leak the plaintext.
    expect(cipher).not.toContain(plaintext)
    expect(decryptToken(cipher)).toBe(plaintext)
  })

  it('round-trips unicode and long tokens', () => {
    const plaintext = 'tøken-✓-' + 'x'.repeat(2000)
    const cipher = encrypt(plaintext, process.env.ENCRYPTION_KEY!)
    expect(decryptToken(cipher)).toBe(plaintext)
  })

  it('decrypting with the wrong key does NOT return the plaintext', () => {
    const plaintext = 'secret-value'
    const cipher = encrypt(plaintext, 'key-a')
    process.env.ENCRYPTION_KEY = 'key-b'
    // Wrong-key decrypt yields garbage or throws on malformed UTF-8; either way
    // it must never recover the original plaintext.
    let result: string | undefined
    try {
      result = decryptToken(cipher)
    } catch {
      result = undefined
    }
    expect(result).not.toBe(plaintext)
  })

  it('decryptToken throws when ENCRYPTION_KEY is not set', () => {
    const cipher = encrypt('x', 'k')
    delete process.env.ENCRYPTION_KEY
    expect(() => decryptToken(cipher)).toThrow(/ENCRYPTION_KEY/)
  })
})

// The BYOA connect flow stores the webhook verify token encrypted with the same
// scheme. The app webhook route decrypts it with decryptToken and compares it to
// Meta's `hub.verify_token`. This documents that verify-token round-trip.
describe('webhook verify-token handling', () => {
  it('an encrypted verify token decrypts back for the hub.verify_token check', () => {
    const verifyToken = 'my-byoa-verify-token-123'
    const encrypted = encrypt(verifyToken, process.env.ENCRYPTION_KEY!)

    const incomingFromMeta = 'my-byoa-verify-token-123'
    const expected = decryptToken(encrypted)
    expect(expected).toBe(verifyToken)
    // A matching hub.verify_token authenticates the subscription.
    expect(incomingFromMeta === expected).toBe(true)
    // A mismatching token must be rejected.
    expect('wrong-token' === expected).toBe(false)
  })
})
