import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'

import { requireAuth } from '@/lib/auth/route-handler'
import { getAgentById } from '@vibesboard/agents/server'
import { getQrDataUrl } from '@/lib/qr'
import { buildShareUrl } from '@/lib/share-url'
import { canEditAgent } from '@vibesboard/agents/permissions'

export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  // Look up the agent by id
  const agent = await getAgentById(id)

  if (!agent) {
    return new NextResponse('Not found', { status: 404 })
  }

  const canEdit = await canEditAgent({
    sessionUserId: authResult.user.id,
    agentOwnerId: agent.userId,
    tenantId: agent.tenantId
  })

  if (!canEdit) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  const headersList = await headers()
  const url = buildShareUrl(headersList, agent.tenantSlug, agent.agentUrl)
  const qrDataUrl = await getQrDataUrl(url)

  return NextResponse.json({ url, qrDataUrl })
}
