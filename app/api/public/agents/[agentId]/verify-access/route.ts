import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { getAgentById } from '@/lib/agents/server'
import { ensureExternalSessionId } from '@/lib/agent/cookies'
import {
  verifyPassword,
  setAccessCookie,
  redeemInviteCode
} from '@/lib/agent/access-gate'

export const runtime = 'nodejs'

const verifyAccessSchema = z.object({
  type: z.enum(['password', 'invite_code']),
  value: z.string().min(1).max(200)
})

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
    return NextResponse.json({ error: 'Agent allows anonymous access' }, { status: 400 })
  }

  const body = await req.json()
  const parsed = verifyAccessSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { type, value } = parsed.data
  const isEmbed = req.headers.get('x-embed') === 'true'

  if (type === 'password') {
    if (!agent.accessPassword) {
      return NextResponse.json({ error: 'Password not configured' }, { status: 403 })
    }
    if (!verifyPassword(value, agent.accessPassword)) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 403 })
    }
    await setAccessCookie(agentId, { crossOrigin: isEmbed })
    return NextResponse.json({ ok: true })
  }

  // type === 'invite_code'
  const externalId = await ensureExternalSessionId({ crossOrigin: isEmbed })
  const result = await redeemInviteCode(agent.tenantId!, agentId, value, externalId)

  if (!result.ok) {
    const messages: Record<string, string> = {
      invalid: 'Invalid code',
      revoked: 'This code has been revoked',
      expired: 'This code has expired',
      max_uses_reached: 'This code has reached its usage limit'
    }
    return NextResponse.json(
      { error: messages[result.reason], code: result.reason },
      { status: 403 }
    )
  }

  await setAccessCookie(agentId, { crossOrigin: isEmbed })
  return NextResponse.json({ ok: true })
}
