import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { getAgentById } from '@vibesboard/agents/server'
import { getAgentAccessPasswordHash } from '@vibesboard/agents/access-password'
import { ensureExternalSessionId } from '@/lib/agent-cookies'
import {
  verifyPassword,
  setAccessCookie,
  redeemInviteCode
} from '@/lib/access-gate'
import {
  consumeRateLimit,
  getRateLimitSalt,
  getTrustedClientAddress,
  type RateLimitResult
} from '@vibesboard/policy/rate-limit'

export const runtime = 'nodejs'

const verifyAccessSchema = z.object({
  value: z.string().min(1).max(200)
})

function positiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function rateLimitResponse(result: RateLimitResult) {
  const retryAfter = Math.max(
    1,
    Math.ceil((result.resetAt.getTime() - Date.now()) / 1_000)
  )
  return NextResponse.json(
    {
      error: 'rate_limit_reached',
      message: 'Too many attempts. Please try again shortly.'
    },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } }
  )
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params
  const agent = await getAgentById(agentId)

  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  if (agent.allowAnonymous) {
    return NextResponse.json(
      { error: 'Agent allows anonymous access' },
      { status: 400 }
    )
  }

  const isEmbed = req.headers.get('x-embed') === 'true'

  // Throttle before touching password/invite-code verification. Without this an
  // attacker can brute-force the gate password and the ~1e9 invite-code space
  // at full speed. Keyed per-session, per-address, and per-agent so a single
  // rotating input can't evade all three.
  const externalId = await ensureExternalSessionId({ crossOrigin: isEmbed })
  const salt = getRateLimitSalt()
  const windowMs = positiveIntegerEnv(
    'VERIFY_ACCESS_RATE_LIMIT_WINDOW_MS',
    60_000
  )
  const clientAddress = getTrustedClientAddress(req.headers)
  const checks = [
    consumeRateLimit({
      scope: `verify-access-session:${agentId}`,
      identifier: externalId,
      salt,
      limit: positiveIntegerEnv('VERIFY_ACCESS_SESSION_RATE_LIMIT', 8),
      windowMs
    }),
    consumeRateLimit({
      scope: 'verify-access-agent',
      identifier: agentId,
      salt,
      limit: positiveIntegerEnv('VERIFY_ACCESS_AGENT_RATE_LIMIT', 100),
      windowMs
    })
  ]
  if (clientAddress) {
    checks.push(
      consumeRateLimit({
        scope: `verify-access-address:${agentId}`,
        identifier: clientAddress,
        salt,
        limit: positiveIntegerEnv('VERIFY_ACCESS_ADDRESS_RATE_LIMIT', 20),
        windowMs
      })
    )
  }
  const rejected = (await Promise.all(checks)).find(result => !result.allowed)
  if (rejected) return rateLimitResponse(rejected)

  const body = await req.json()
  const parsed = verifyAccessSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { value } = parsed.data

  // Fetch the hash server-side rather than reading it off the mapped agent —
  // that field is serialized into the gated pages' RSC payload, so anonymous
  // visitors were handed the hash before submitting anything.
  const accessPasswordHash = await getAgentAccessPasswordHash(agentId)

  // Try password first
  if (accessPasswordHash && verifyPassword(value, accessPasswordHash)) {
    await setAccessCookie(agentId, { crossOrigin: isEmbed })
    return NextResponse.json({ ok: true })
  }

  // Then try invite code (externalId already resolved above for rate limiting)
  const result = await redeemInviteCode(
    agent.tenantId!,
    agentId,
    value,
    externalId
  )

  if (result.ok) {
    await setAccessCookie(agentId, { crossOrigin: isEmbed })
    return NextResponse.json({ ok: true })
  }

  // Both failed — return appropriate error
  const messages: Record<string, string> = {
    invalid: 'Invalid password or code',
    revoked: 'This code has been revoked',
    expired: 'This code has expired',
    max_uses_reached: 'This code has reached its usage limit'
  }
  return NextResponse.json(
    { error: messages[result.reason], code: result.reason },
    { status: 403 }
  )
}
