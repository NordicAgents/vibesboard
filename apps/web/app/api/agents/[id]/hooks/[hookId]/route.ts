import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireAuth } from '@/lib/firebase/route-handler'
import { getAgentById } from '@/lib/agents/server'
import { canEditAgent } from '@/lib/agents/permissions'
import { getHook, updateHook, deleteHook } from '@/lib/agents/hooks'

export const runtime = 'nodejs'

const patchHookSchema = z
  .object({
    name: z.string().min(1).max(100).trim().optional(),
    status: z.enum(['active', 'inactive']).optional()
  })
  .refine(d => d.name !== undefined || d.status !== undefined, {
    message: 'At least one of name or status must be provided'
  })

async function resolveAndAuthorise(
  agentId: string,
  hookId: string,
  userId: string
) {
  const agent = await getAgentById(agentId)
  if (!agent) return { error: new NextResponse('Not found', { status: 404 }) }

  const canEdit = await canEditAgent({
    sessionUserId: userId,
    agentOwnerId: agent.userId,
    tenantId: agent.tenantId
  })
  if (!canEdit) return { error: new NextResponse('Forbidden', { status: 403 }) }

  const hook = await getHook(agent.tenantId!, agent.id, hookId)
  if (!hook)
    return { error: new NextResponse('Hook not found', { status: 404 }) }

  return { agent, hook }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; hookId: string }> }
) {
  const { id, hookId } = await params
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const resolved = await resolveAndAuthorise(id, hookId, authResult.user.id)
  if ('error' in resolved) return resolved.error

  const body = await req.json()
  const patch = patchHookSchema.parse(body)

  await updateHook(resolved.agent.tenantId!, resolved.agent.id, hookId, patch)

  return NextResponse.json({ success: true })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; hookId: string }> }
) {
  const { id, hookId } = await params
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const resolved = await resolveAndAuthorise(id, hookId, authResult.user.id)
  if ('error' in resolved) return resolved.error

  await deleteHook(resolved.agent.tenantId!, resolved.agent.id, hookId)

  return new NextResponse(null, { status: 204 })
}
