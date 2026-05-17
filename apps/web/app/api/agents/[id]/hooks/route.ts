import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireAuth } from '@/lib/firebase/route-handler'
import { getAgentById } from '@vibesboard/agents/server'
import { canEditAgent } from '@vibesboard/agents/permissions'
import { createHook, listHooks } from '@vibesboard/agents/hooks'

export const runtime = 'nodejs'

const createHookSchema = z.object({
  name: z.string().min(1).max(100).trim()
})

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const agent = await getAgentById(id)
  if (!agent) return new NextResponse('Not found', { status: 404 })

  const canEdit = await canEditAgent({
    sessionUserId: authResult.user.id,
    agentOwnerId: agent.userId,
    tenantId: agent.tenantId
  })
  if (!canEdit) return new NextResponse('Forbidden', { status: 403 })

  const hooks = await listHooks(agent.tenantId!, agent.id)
  return NextResponse.json({ hooks })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const agent = await getAgentById(id)
  if (!agent) return new NextResponse('Not found', { status: 404 })

  const canEdit = await canEditAgent({
    sessionUserId: authResult.user.id,
    agentOwnerId: agent.userId,
    tenantId: agent.tenantId
  })
  if (!canEdit) return new NextResponse('Forbidden', { status: 403 })

  const body = await req.json()
  const { name } = createHookSchema.parse(body)

  const { hook, secretKey } = await createHook(agent.tenantId!, agent.id, name)

  // secretKey is returned ONCE — the caller must save it
  return NextResponse.json({ hook, secretKey }, { status: 201 })
}
