import { cookies } from 'next/headers'
import { z } from 'zod'
import { signToken, verifyToken } from '@vibesboard/ai/access-gate-crypto'

export {
  hashPassword,
  verifyPassword,
  generateCode
} from '@vibesboard/ai/access-gate-crypto'

export {
  createInviteCode,
  listInviteCodes,
  revokeInviteCode,
  redeemInviteCode,
  type InviteCodeError
} from '@vibesboard/agents/invite-codes'

// ─── Request schemas ────────────────────────────────────────────────────────

export const setPasswordSchema = z.object({
  password: z.string().min(1).max(200)
})

// ─── Session cookie (HMAC-signed, session-scoped) ────────────────────────────

function cookieName(agentId: string) {
  return `va_access_${agentId}`
}

export async function setAccessCookie(
  agentId: string,
  opts?: { crossOrigin?: boolean }
) {
  const cookieStore = await cookies()
  cookieStore.set({
    name: cookieName(agentId),
    value: signToken(agentId),
    httpOnly: true,
    secure: true,
    sameSite: opts?.crossOrigin ? 'none' : 'lax',
    path: '/'
    // No maxAge = session cookie — dies on browser close
  })
}

export async function hasValidAccessCookie(agentId: string): Promise<boolean> {
  const cookieStore = await cookies()
  const token = cookieStore.get(cookieName(agentId))?.value
  if (!token) return false
  return verifyToken(token, agentId)
}
