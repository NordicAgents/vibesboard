import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { getAgentById } from '@vibesboard/agents/server'
import { ensureExternalSessionId } from '@/lib/agent-cookies'
import {
  verifyPassword,
  setAccessCookie,
  redeemInviteCode
} from '@/lib/access-gate'

export const runtime = 'nodejs'

const verifyAccessSchema = z.object({
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
    return NextResponse.json(
      { error: 'Agent allows anonymous access' },
      { status: 400 }
    )
  }

  const body = await req.json()
  const parsed = verifyAccessSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { value } = parsed.data
  const isEmbed = req.headers.get('x-embed') === 'true'

  // Try password first
  if (agent.accessPassword && verifyPassword(value, agent.accessPassword)) {
    await setAccessCookie(agentId, { crossOrigin: isEmbed })
    return NextResponse.json({ ok: true })
  }

  // Then try invite code
  const externalId = await ensureExternalSessionId({ crossOrigin: isEmbed })
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
