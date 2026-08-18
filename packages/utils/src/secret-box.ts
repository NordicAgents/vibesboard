/**
 * Authenticated symmetric encryption for secrets stored in the database
 * (OAuth tokens, provider API keys, channel credentials).
 *
 * Format (versioned, colon-delimited base64 — none of the fields contain ':'):
 *
 *   v1:<keyId>:<iv>:<authTag>:<ciphertext>
 *
 * - AES-256-GCM (authenticated: tampering and wrong keys fail loudly, unlike
 *   the previous CryptoJS AES-CBC which returned '' on a bad key).
 * - `keyId` is a short fingerprint of the master key, so `unseal` can pick the
 *   right key out of the configured set — this is what makes rotation possible.
 * - Rotation: ENCRYPTION_KEY seals all new values; retired keys listed in
 *   ENCRYPTION_KEYS_OLD (comma-separated) are kept for decrypt only. A value
 *   re-seals to the current key the next time it is written.
 * - Legacy: any token that is not `v1:`-prefixed is treated as the old CryptoJS
 *   AES ciphertext and decrypted transparently, so existing rows keep working.
 *
 * Node-only (node:crypto). Imported via the `@vibesboard/utils/secret-box`
 * subpath, never the client-safe barrel.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes
} from 'node:crypto'
import CryptoJS from 'crypto-js'

const VERSION = 'v1'
const HKDF_SALT = Buffer.from('vibesboard/secret-box/v1')
const HKDF_INFO = Buffer.from('aes-256-gcm')
/** GCM tag length, pinned on both ends so a truncated tag cannot verify. */
const TAG_BYTES = 16

interface KeyMaterial {
  keyId: string
  aesKey: Buffer
  raw: string
}

// Deriving the AES key and fingerprint is deterministic; memoize by the raw
// master-key string so hot paths do not re-derive on every call.
const keyCache = new Map<string, KeyMaterial>()

function deriveKey(raw: string): KeyMaterial {
  const cached = keyCache.get(raw)
  if (cached) return cached
  const aesKey = Buffer.from(
    hkdfSync('sha256', Buffer.from(raw, 'utf8'), HKDF_SALT, HKDF_INFO, 32)
  )
  const keyId = createHash('sha256')
    .update(raw, 'utf8')
    .digest('hex')
    .slice(0, 8)
  const material: KeyMaterial = { keyId, aesKey, raw }
  keyCache.set(raw, material)
  return material
}

function currentKey(): KeyMaterial {
  const raw = process.env.ENCRYPTION_KEY
  if (!raw) {
    throw new Error('[secret-box] ENCRYPTION_KEY is not set')
  }
  return deriveKey(raw)
}

/** The current key plus any retired keys, for decrypt-time key selection. */
function allKeys(): KeyMaterial[] {
  const keys = [currentKey()]
  const old = process.env.ENCRYPTION_KEYS_OLD
  if (old) {
    for (const raw of old
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)) {
      keys.push(deriveKey(raw))
    }
  }
  return keys
}

/** True if the token is in the modern (v1 GCM) format rather than legacy. */
export function isModernToken(token: string): boolean {
  return token.startsWith(`${VERSION}:`)
}

/** Encrypt a plaintext secret with the current key. Returns the opaque token. */
export function sealSecret(plaintext: string): string {
  const { keyId, aesKey } = currentKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', aesKey, iv, {
    authTagLength: TAG_BYTES
  })
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ])
  const tag = cipher.getAuthTag()
  return [
    VERSION,
    keyId,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64')
  ].join(':')
}

/** Recover plaintext from a token (modern or legacy CryptoJS). Throws on failure. */
export function unsealSecret(token: string): string {
  if (isModernToken(token)) {
    const parts = token.split(':')
    if (parts.length !== 5) {
      throw new Error('[secret-box] Malformed v1 token')
    }
    const [, keyId, ivB64, tagB64, ctB64] = parts
    const keys = allKeys()
    // Prefer the key whose fingerprint matches; fall back to trying all keys
    // (covers a fingerprint collision or a value sealed before a keyId change).
    const matched = keys.filter(k => k.keyId === keyId)
    const candidates = matched.length ? matched : keys
    for (const k of candidates) {
      try {
        // authTagLength is pinned so setAuthTag rejects a truncated tag.
        // Without it, node accepts tags as short as 4 bytes, which would let
        // anyone who can tamper with a stored token forge at ~2^32 instead of
        // ~2^128. sealSecret always emits 16 bytes, so this rejects nothing
        // that was written by this module.
        const decipher = createDecipheriv(
          'aes-256-gcm',
          k.aesKey,
          Buffer.from(ivB64, 'base64'),
          { authTagLength: TAG_BYTES }
        )
        decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
        return Buffer.concat([
          decipher.update(Buffer.from(ctB64, 'base64')),
          decipher.final()
        ]).toString('utf8')
      } catch {
        // Auth failure with this key — try the next.
      }
    }
    throw new Error(
      '[secret-box] Unable to decrypt: no matching key or auth failure'
    )
  }

  // Legacy CryptoJS AES (passphrase mode). Try current then retired keys.
  //
  // A wrong key does NOT reliably yield '': CryptoJS decrypts to arbitrary
  // bytes, and `toString(enc.Utf8)` *throws* "Malformed UTF-8 data" whenever
  // those bytes are not valid UTF-8. Whether that happens depends on the random
  // salt baked into each ciphertext, so roughly one legacy value in forty took
  // the throwing path. Without this catch the loop aborted on the first wrong
  // key and never reached ENCRYPTION_KEYS_OLD — and because the salt is fixed
  // once a value is stored, those rows stayed undecryptable for good after a
  // rotation rather than failing intermittently.
  for (const k of allKeys()) {
    let plaintext: string
    try {
      plaintext = CryptoJS.AES.decrypt(token, k.raw).toString(CryptoJS.enc.Utf8)
    } catch {
      continue // Wrong key for this ciphertext; try the next one.
    }
    if (plaintext) return plaintext
  }
  throw new Error('[secret-box] Unable to decrypt legacy token')
}

/**
 * For columns migrating from PLAINTEXT storage: unseal when the value is a
 * sealed token, otherwise return it unchanged (a row written before the
 * migration). Idempotent, so it is safe to apply on a value that may already
 * be plaintext.
 *
 * Do NOT use this for fields that were previously CryptoJS-encrypted — those
 * are not `v1:`-prefixed and must go through `unsealSecret`, which knows the
 * legacy format.
 */
export function unsealMaybeSealed(value: string): string {
  return isModernToken(value) ? unsealSecret(value) : value
}

/** Test/tooling hook to clear the derived-key cache (e.g. after changing env). */
export function _resetKeyCacheForTests(): void {
  keyCache.clear()
}
