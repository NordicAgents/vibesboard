import { NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/firebase/route-handler'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { isFeatureEnabled } from '@/lib/features'
import { mapAgentLinkDoc } from '@/lib/agent-links/db'
import { updateAgentLinkSchema } from '@/lib/agent-links/schema'

export const runtime = 'nodejs'

type RouteParams = {
  params: Promise<{ id: string; linkId: string }>
}

/**
 * GET /api/tenants/[id]/agent-links/[linkId]
 * Get a single agent link
 */
export async function GET(req: Request, { params }: RouteParams) {
  const { id: tenantId, linkId } = await params

  const auth = await requireTenantAdmin(tenantId)
  if (!auth.ok) return auth.response

  const doc = await adminDb
    .collection(Collections.agentLinks(tenantId))
    .doc(linkId)
    .get()

  if (!doc.exists) {
    return NextResponse.json({ error: 'Agent link not found' }, { status: 404 })
  }

  return NextResponse.json({ link: mapAgentLinkDoc(doc.data()!) })
}

/**
 * PATCH /api/tenants/[id]/agent-links/[linkId]
 * Update an agent link (swap agent, rename, toggle active)
 */
export async function PATCH(req: Request, { params }: RouteParams) {
  const { id: tenantId, linkId } = await params

  const auth = await requireTenantAdmin(tenantId)
  if (!auth.ok) return auth.response

  const enabled = await isFeatureEnabled(tenantId, 'AGENT_LINKS')
  if (!enabled) {
    return NextResponse.json(
      { error: 'Agent Links feature is not enabled for this tenant' },
      { status: 403 }
    )
  }

  const doc = await adminDb
    .collection(Collections.agentLinks(tenantId))
    .doc(linkId)
    .get()

  if (!doc.exists) {
    return NextResponse.json({ error: 'Agent link not found' }, { status: 404 })
  }

  const body = await req.json()
  const parsed = updateAgentLinkSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const updates: Record<string, any> = {
    updatedAt: new Date().toISOString()
  }

  if (parsed.data.agentId !== undefined) {
    // Verify the new agent exists in this tenant
    const agentDoc = await adminDb
      .collection(Collections.agents(tenantId))
      .doc(parsed.data.agentId)
      .get()

    if (!agentDoc.exists) {
      return NextResponse.json(
        { error: 'Agent not found in this tenant' },
        { status: 404 }
      )
    }
    updates.agentId = parsed.data.agentId
  }

  if (parsed.data.name !== undefined) updates.name = parsed.data.name
  if (parsed.data.description !== undefined)
    updates.description = parsed.data.description
  if (parsed.data.isActive !== undefined)
    updates.isActive = parsed.data.isActive

  await adminDb
    .collection(Collections.agentLinks(tenantId))
    .doc(linkId)
    .update(updates)

  const updated = await adminDb
    .collection(Collections.agentLinks(tenantId))
    .doc(linkId)
    .get()

  return NextResponse.json({ link: mapAgentLinkDoc(updated.data()!) })
}

/**
 * DELETE /api/tenants/[id]/agent-links/[linkId]
 * Delete an agent link
 */
export async function DELETE(req: Request, { params }: RouteParams) {
  const { id: tenantId, linkId } = await params

  const auth = await requireTenantAdmin(tenantId)
  if (!auth.ok) return auth.response

  const doc = await adminDb
    .collection(Collections.agentLinks(tenantId))
    .doc(linkId)
    .get()

  if (!doc.exists) {
    return NextResponse.json({ error: 'Agent link not found' }, { status: 404 })
  }

  await adminDb
    .collection(Collections.agentLinks(tenantId))
    .doc(linkId)
    .delete()

  return NextResponse.json({ success: true })
}
