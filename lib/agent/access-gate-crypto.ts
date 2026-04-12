import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

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

// ─── Password hashing (HMAC-based) ──────────────────────────────────────────

export function hashPassword(plaintext: string): string {
  return createHmac('sha256', getSecret()).update(plaintext).digest('hex')
}

export function verifyPassword(plaintext: string, hash: string): boolean {
  const computed = hashPassword(plaintext)
  if (computed.length !== hash.length) return false
  return timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(hash, 'hex'))
}

// ─── Token signing (HMAC-signed) ────────────────────────────────────────────

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
    const expected = createHmac('sha256', getSecret()).update(payload).digest('hex')
    if (sig.length !== expected.length) return false
    if (!timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return false
    const data = JSON.parse(payload)
    return data.agentId === agentId
  } catch {
    return false
  }
}

// ─── Code generation helper ──────────────────────────────────────────────────

export function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I/O/0/1 for readability
  const bytes = randomBytes(6)
  let result = 'VIBE-'
  for (let i = 0; i < 6; i++) {
    result += chars[bytes[i] % chars.length]
  }
  return result
}
