import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireAuth } from '@/lib/auth/route-handler'
import { getAgentById } from '@vibesboard/agents/server'
import { canEditAgent } from '@vibesboard/agents/permissions'
import { createInviteCode, listInviteCodes } from '@/lib/access-gate'

export const runtime = 'nodejs'

const createCodeSchema = z.object({
  code: z.string().min(3).max(50).optional(),
  expiresAt: z.string().nullable().optional(),
  maxUses: z.number().int().min(1).nullable().optional()
})

// GET — list invite codes
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const agent = await getAgentById(id)
  if (!agent) return new NextResponse('Not found', { status: 404 })

  const allowed = await canEditAgent({
    sessionUserId: authResult.user.id,
    agentOwnerId: agent.userId,
    tenantId: agent.tenantId!
  })
  if (!allowed) return new NextResponse('Forbidden', { status: 403 })

  const codes = await listInviteCodes(agent.tenantId!, id)
  return NextResponse.json(codes)
}

// POST — create invite code
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const agent = await getAgentById(id)
  if (!agent) return new NextResponse('Not found', { status: 404 })

  const allowed = await canEditAgent({
    sessionUserId: authResult.user.id,
    agentOwnerId: agent.userId,
    tenantId: agent.tenantId!
  })
  if (!allowed) return new NextResponse('Forbidden', { status: 403 })

  const body = await req.json()
  const parsed = createCodeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const code = await createInviteCode(agent.tenantId!, id, parsed.data)
  return NextResponse.json(code, { status: 201 })
}
