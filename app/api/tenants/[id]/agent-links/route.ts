import { NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/firebase/route-handler'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { isFeatureEnabled } from '@/lib/features'
import { getAgentLinksForTenant, isLinkSlugAvailable } from '@/lib/agent-links/db'
import { createAgentLinkSchema } from '@/lib/agent-links/schema'
import { nanoid } from '@/lib/utils'

export const runtime = 'nodejs'

type RouteParams = {
  params: Promise<{ id: string }>
}

/**
 * GET /api/tenants/[id]/agent-links
 * List all agent links for a tenant
 */
export async function GET(req: Request, { params }: RouteParams) {
  const { id: tenantId } = await params

  const auth = await requireTenantAdmin(tenantId)
  if (!auth.ok) return auth.response

  const enabled = await isFeatureEnabled(tenantId, 'AGENT_LINKS')
  if (!enabled) {
    return NextResponse.json(
      { error: 'Agent Links feature is not enabled for this tenant' },
      { status: 403 }
    )
  }

  const links = await getAgentLinksForTenant(tenantId)

  return NextResponse.json({ links })
}

/**
 * POST /api/tenants/[id]/agent-links
 * Create a new agent link
 */
export async function POST(req: Request, { params }: RouteParams) {
  const { id: tenantId } = await params

  const auth = await requireTenantAdmin(tenantId)
  if (!auth.ok) return auth.response

  const enabled = await isFeatureEnabled(tenantId, 'AGENT_LINKS')
  if (!enabled) {
    return NextResponse.json(
      { error: 'Agent Links feature is not enabled for this tenant' },
      { status: 403 }
    )
  }

  const body = await req.json()
  const parsed = createAgentLinkSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const { slug, agentId, name, description } = parsed.data

  // Check slug uniqueness
  const available = await isLinkSlugAvailable(slug, tenantId)
  if (!available) {
    return NextResponse.json(
      { error: 'This slug is already in use. Choose a different one.' },
      { status: 409 }
    )
  }

  // Verify the agent exists in this tenant
  const agentDoc = await adminDb
    .collection(Collections.agents(tenantId))
    .doc(agentId)
    .get()

  if (!agentDoc.exists) {
    return NextResponse.json(
      { error: 'Agent not found in this tenant' },
      { status: 404 }
    )
  }

  const now = new Date().toISOString()
  const linkId = nanoid()
  const linkData = {
    id: linkId,
    tenantId,
    slug,
    agentId,
    name,
    description: description ?? null,
    isActive: true,
    createdBy: auth.user.id,
    createdAt: now,
    updatedAt: now
  }

  await adminDb
    .collection(Collections.agentLinks(tenantId))
    .doc(linkId)
    .set(linkData)

  return NextResponse.json({ link: linkData }, { status: 201 })
}
