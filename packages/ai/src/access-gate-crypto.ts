import {
  createHmac,
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual
} from 'crypto'

/** Max redemption records stored inline on an invite-code document. */
export const MAX_STORED_REDEMPTIONS = 100

export function getSecret(): string {
  const secret = process.env.ACCESS_GATE_SECRET
  if (!secret) {
    throw new Error(
      'ACCESS_GATE_SECRET environment variable is required for password hashing and cookie signing.'
    )
  }
  return secret
}

// ─── Password hashing (versioned, salted scrypt + server-side pepper) ───────

const PASSWORD_HASH_VERSION = 'v3'
const LEGACY_HMAC_VERSION = 'v2'
const HEX_32_BYTES = /^[0-9a-f]{64}$/i
const HEX_16_BYTES = /^[0-9a-f]{32}$/i
const SCRYPT_OPTIONS = {
  N: 2 ** 15,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024
} as const

function passwordDigest(plaintext: string, salt: string): string {
  const peppered = Buffer.concat([
    Buffer.from(plaintext, 'utf8'),
    Buffer.from([0]),
    Buffer.from(getSecret(), 'utf8')
  ])
  return scryptSync(
    peppered,
    Buffer.from(salt, 'hex'),
    32,
    SCRYPT_OPTIONS
  ).toString('hex')
}

function legacyV2Digest(plaintext: string, salt: string): string {
  return createHmac('sha256', getSecret())
    .update(`${LEGACY_HMAC_VERSION}:${salt}:`)
    .update(plaintext)
    .digest('hex')
}

function equalHex(left: string, right: string): boolean {
  if (!HEX_32_BYTES.test(left) || !HEX_32_BYTES.test(right)) return false
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
}

export function hashPassword(plaintext: string): string {
  const salt = randomBytes(16).toString('hex')
  return `${PASSWORD_HASH_VERSION}$${salt}$${passwordDigest(plaintext, salt)}`
}

export function verifyPassword(plaintext: string, hash: string): boolean {
  const [version, salt, digest, extra] = hash.split('$')
  if (
    version === PASSWORD_HASH_VERSION &&
    !extra &&
    HEX_16_BYTES.test(salt ?? '') &&
    HEX_32_BYTES.test(digest ?? '')
  ) {
    return equalHex(passwordDigest(plaintext, salt), digest)
  }

  // Migration path for v2 hashes. New and changed passwords are always v3;
  // this branch can disappear after existing access gates have been rotated.
  if (
    version === LEGACY_HMAC_VERSION &&
    !extra &&
    HEX_16_BYTES.test(salt ?? '') &&
    HEX_32_BYTES.test(digest ?? '')
  ) {
    return equalHex(legacyV2Digest(plaintext, salt), digest)
  }

  // Backward compatibility: existing rows contain the old unsalted 64-char
  // HMAC. They remain usable until the owner next changes the access password.
  if (HEX_32_BYTES.test(hash)) {
    const legacy = createHmac('sha256', getSecret())
      .update(plaintext)
      .digest('hex')
    return equalHex(legacy, hash)
  }

  return false
}

// ─── Token signing (HMAC-signed, time-limited) ──────────────────────────────

/**
 * Access-cookie lifetime. The token embeds its issue time and verifyToken
 * enforces this window, so a copied cookie value stops working after it — the
 * access grant is no longer effectively permanent. Overridable for deployments
 * that want a shorter/longer gate session.
 */
export const ACCESS_TOKEN_TTL_MS = (() => {
  const raw = Number(process.env.ACCESS_GATE_TOKEN_TTL_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : 12 * 60 * 60 * 1000
})()

export function signToken(agentId: string): string {
  const payload = JSON.stringify({ agentId, ts: Date.now() })
  const sig = createHmac('sha256', getSecret()).update(payload).digest('hex')
  return Buffer.from(payload).toString('base64') + '.' + sig
}

export function verifyToken(token: string, agentId: string): boolean {
  const [b64, sig] = token.split('.')
  if (!b64 || !sig) return false
  try {
    const payload = Buffer.from(b64, 'base64').toString()
    const expected = createHmac('sha256', getSecret())
      .update(payload)
      .digest('hex')
    if (sig.length !== expected.length) return false
    if (!timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex')))
      return false
    const data = JSON.parse(payload)
    if (data.agentId !== agentId) return false
    // Enforce expiry: a valid signature is not enough — the token must also be
    // within its lifetime. Reject a missing/invalid/future timestamp too.
    if (typeof data.ts !== 'number' || !Number.isFinite(data.ts)) return false
    const age = Date.now() - data.ts
    if (age < 0 || age > ACCESS_TOKEN_TTL_MS) return false
    return true
  } catch {
    return false
  }
}

// ─── Code generation helper ──────────────────────────────────────────────────

export function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I/O/0/1 for readability
  let result = 'VIBE-'
  for (let i = 0; i < 6; i++) {
    result += chars[randomInt(chars.length)]
  }
  return result
}
