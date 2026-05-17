import { NextRequest, NextResponse } from 'next/server'

import { requireAuth } from '@/lib/firebase/route-handler'
import { getAgentById } from '@vibesboard/agents/server'
import { canEditAgent } from '@vibesboard/agents/permissions'
import { listHooks } from '@vibesboard/agents/hooks'
import { isFeatureEnabled } from '@vibesboard/policy/features'
import { INTEGRATION_REGISTRY } from '@vibesboard/integrations/registry'
import type { IntegrationConnectionSummary } from '@vibesboard/integrations/types'

export const runtime = 'nodejs'

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
    tenantId: agent.tenantId ?? null
  })
  if (!canEdit) return new NextResponse('Forbidden', { status: 403 })

  if (!agent.tenantId) {
    return new NextResponse('Agent has no tenant', { status: 400 })
  }
  const tenantId = agent.tenantId

  const integrations: IntegrationConnectionSummary[] = await Promise.all(
    INTEGRATION_REGISTRY.map(async definition => {
      const available = definition.featureFlag
        ? await isFeatureEnabled(tenantId, definition.featureFlag)
        : true

      const summary: IntegrationConnectionSummary = {
        type: definition.type,
        available,
        configured: false
      }

      if (!available) return summary

      switch (definition.type) {
        case 'hooks': {
          try {
            const hooks = await listHooks(tenantId, agent.id)
            summary.activeConnections = hooks.length
            summary.configured = hooks.length > 0
          } catch {
            // same
          }
          break
        }
        case 'chatwoot': {
          try {
            const { listChatwootConnections } =
              await import('@vibesboard/channel-chatwoot/connections')
            const connections = await listChatwootConnections(
              tenantId,
              agent.id,
              'active'
            )
            summary.activeConnections = connections.length
            summary.configured = connections.length > 0
          } catch {
            // same
          }
          break
        }
        case 'embed_widget': {
          // Embed widget is "configured" if agent allows anonymous chat
          summary.configured = agent.allowAnonymous === true
          break
        }
      }

      return summary
    })
  )

  return NextResponse.json({ integrations })
}
