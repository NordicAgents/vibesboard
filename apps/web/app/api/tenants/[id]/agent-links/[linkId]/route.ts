import { NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/auth/route-handler'
import { isFeatureEnabled } from '@vibesboard/policy/features'
import {
  getAgentLinkById,
  updateAgentLink,
  deleteAgentLink
} from '@vibesboard/policy/agent-links/db'
import { updateAgentLinkSchema } from '@vibesboard/policy/agent-links/schema'
import { getAgentForMember } from '@vibesboard/agents/server'

export const runtime = 'nodejs'
type RouteParams = { params: Promise<{ id: string; linkId: string }> }

export async function GET(req: Request, { params }: RouteParams) {
  const { id: tenantId, linkId } = await params
  const auth = await requireTenantAdmin(tenantId)
  if (!auth.ok) return auth.response
  const link = await getAgentLinkById(tenantId, linkId)
  if (!link)
    return NextResponse.json({ error: 'Agent link not found' }, { status: 404 })
  return NextResponse.json({ link })
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const { id: tenantId, linkId } = await params
  const auth = await requireTenantAdmin(tenantId)
  if (!auth.ok) return auth.response
  if (!(await isFeatureEnabled(tenantId, 'AGENT_LINKS')))
    return NextResponse.json(
      { error: 'Agent Links feature is not enabled for this tenant' },
      { status: 403 }
    )

  const existing = await getAgentLinkById(tenantId, linkId)
  if (!existing)
    return NextResponse.json({ error: 'Agent link not found' }, { status: 404 })

  const body = await req.json()
  const parsed = updateAgentLinkSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )

  if (
    parsed.data.agentId !== undefined &&
    !(await getAgentForMember(tenantId, parsed.data.agentId))
  )
    return NextResponse.json(
      { error: 'Agent not found in this tenant' },
      { status: 404 }
    )

  const link = await updateAgentLink(tenantId, linkId, parsed.data)
  if (!link)
    return NextResponse.json({ error: 'Agent link not found' }, { status: 404 })
  return NextResponse.json({ link })
}

export async function DELETE(req: Request, { params }: RouteParams) {
  const { id: tenantId, linkId } = await params
  const auth = await requireTenantAdmin(tenantId)
  if (!auth.ok) return auth.response
  const deleted = await deleteAgentLink(tenantId, linkId)
  if (!deleted)
    return NextResponse.json({ error: 'Agent link not found' }, { status: 404 })
  return NextResponse.json({ success: true })
}
