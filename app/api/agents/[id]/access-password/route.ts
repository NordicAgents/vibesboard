import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { requireAuth } from '@/lib/firebase/route-handler'
import { getAgentById } from '@/lib/agents/server'
import { canEditAgent } from '@/lib/agents/permissions'
import { hashPassword } from '@/lib/agent/access-gate'

export const runtime = 'nodejs'

const setPasswordSchema = z.object({
  password: z.string().min(1).max(200)
})

// PUT — set password
export async function PUT(
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
  const parsed = setPasswordSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  await adminDb
    .collection(Collections.agents(agent.tenantId!))
    .doc(id)
    .update({ accessPassword: hashPassword(parsed.data.password) })

  return NextResponse.json({ ok: true })
}

// DELETE — remove password
export async function DELETE(
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

  await adminDb
    .collection(Collections.agents(agent.tenantId!))
    .doc(id)
    .update({ accessPassword: null })

  return NextResponse.json({ ok: true })
}
