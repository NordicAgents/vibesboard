import { NextRequest, NextResponse } from 'next/server'

import { adminDb } from '@vibesboard/adapter-firebase/admin'
import { Collections } from '@vibesboard/contracts'
import { requireAuth } from '@/lib/firebase/route-handler'
import { getAgentById } from '@vibesboard/agents/server'
import { canEditAgent } from '@vibesboard/agents/permissions'
import { hashPassword, setPasswordSchema } from '@/lib/access-gate'

export const runtime = 'nodejs'

async function parseJsonBody(
  req: NextRequest
): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  try {
    return { ok: true, body: await req.json() }
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Body must be valid JSON' },
        { status: 400 }
      )
    }
  }
}

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

  // Agents must always be tenant-scoped to write to the right Firestore path.
  // A null tenantId here would silently target tenants/undefined/agents/{id}
  // and surface as an opaque "no document to update" 500.
  if (!agent.tenantId) {
    console.error('access-password PUT: agent missing tenantId', {
      agentId: id,
      userId: authResult.user.id
    })
    return NextResponse.json(
      { error: 'Agent is missing a tenant assignment' },
      { status: 500 }
    )
  }

  const allowed = await canEditAgent({
    sessionUserId: authResult.user.id,
    agentOwnerId: agent.userId,
    tenantId: agent.tenantId
  })
  if (!allowed) return new NextResponse('Forbidden', { status: 403 })

  const parsedBody = await parseJsonBody(req)
  if (!parsedBody.ok) return parsedBody.response

  const parsed = setPasswordSchema.safeParse(parsedBody.body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', issues: parsed.error.issues },
      { status: 400 }
    )
  }

  try {
    await adminDb
      .collection(Collections.agents(agent.tenantId))
      .doc(id)
      .update({ accessPassword: hashPassword(parsed.data.password) })
  } catch (err) {
    console.error('access-password PUT failed', {
      agentId: id,
      tenantId: agent.tenantId,
      userId: authResult.user.id,
      error: err instanceof Error ? err.message : String(err)
    })
    return NextResponse.json(
      { error: 'Failed to set access password' },
      { status: 500 }
    )
  }

  return NextResponse.json({ ok: true })
}

// DELETE — remove password
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const agent = await getAgentById(id)
  if (!agent) return new NextResponse('Not found', { status: 404 })

  if (!agent.tenantId) {
    console.error('access-password DELETE: agent missing tenantId', {
      agentId: id,
      userId: authResult.user.id
    })
    return NextResponse.json(
      { error: 'Agent is missing a tenant assignment' },
      { status: 500 }
    )
  }

  const allowed = await canEditAgent({
    sessionUserId: authResult.user.id,
    agentOwnerId: agent.userId,
    tenantId: agent.tenantId
  })
  if (!allowed) return new NextResponse('Forbidden', { status: 403 })

  try {
    await adminDb
      .collection(Collections.agents(agent.tenantId))
      .doc(id)
      .update({ accessPassword: null })
  } catch (err) {
    console.error('access-password DELETE failed', {
      agentId: id,
      tenantId: agent.tenantId,
      userId: authResult.user.id,
      error: err instanceof Error ? err.message : String(err)
    })
    return NextResponse.json(
      { error: 'Failed to remove access password' },
      { status: 500 }
    )
  }

  return NextResponse.json({ ok: true })
}
