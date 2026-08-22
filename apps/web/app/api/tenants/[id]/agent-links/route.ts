import { NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/auth/route-handler'
import { isFeatureEnabled } from '@vibesboard/policy/features'
import {
  getAgentLinksForTenant,
  isLinkSlugAvailable,
  createAgentLink
} from '@vibesboard/policy/agent-links/db'
import { createAgentLinkSchema } from '@vibesboard/policy/agent-links/schema'
import { getAgentForMember } from '@vibesboard/agents/server'

export const runtime = 'nodejs'
type RouteParams = { params: Promise<{ id: string }> }

export async function GET(req: Request, { params }: RouteParams) {
  const { id: tenantId } = await params
  const auth = await requireTenantAdmin(tenantId)
  if (!auth.ok) return auth.response
  if (!(await isFeatureEnabled(tenantId, 'AGENT_LINKS')))
    return NextResponse.json(
      { error: 'Agent Links feature is not enabled for this tenant' },
      { status: 403 }
    )
  const links = await getAgentLinksForTenant(tenantId)
  return NextResponse.json({ links })
}

export async function POST(req: Request, { params }: RouteParams) {
  const { id: tenantId } = await params
  const auth = await requireTenantAdmin(tenantId)
  if (!auth.ok) return auth.response
  if (!(await isFeatureEnabled(tenantId, 'AGENT_LINKS')))
    return NextResponse.json(
      { error: 'Agent Links feature is not enabled for this tenant' },
      { status: 403 }
    )

  const body = await req.json()
  const parsed = createAgentLinkSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  const { slug, agentId, name, description } = parsed.data

  if (!(await isLinkSlugAvailable(slug, tenantId)))
    return NextResponse.json(
      { error: 'This slug is already in use. Choose a different one.' },
      { status: 409 }
    )
  if (!(await getAgentForMember(tenantId, agentId)))
    return NextResponse.json(
      { error: 'Agent not found in this tenant' },
      { status: 404 }
    )

  const link = await createAgentLink({
    tenantId,
    agentId,
    slug,
    name,
    description: description ?? null,
    createdBy: auth.user.id
  })
  return NextResponse.json({ link }, { status: 201 })
}
