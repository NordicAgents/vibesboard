import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireAuth } from '@/lib/firebase/route-handler'
import { adminDb } from '@/lib/firebase/admin'
import { isFeatureEnabled } from '@/lib/features'
import {
  deleteChatwootWebhook,
  unassignAgentBotFromInbox,
  deleteChatwootAgentBot
} from '@/lib/chatwoot/api-client'
import {
  getChatwootConnection,
  disconnectChatwootConnection,
  deleteChatwootConnection,
  decryptToken
} from '@/lib/chatwoot/connections'

export const runtime = 'nodejs'

type RouteParams = {
  params: Promise<{ id: string; connectionId: string }>
}

async function findAgentWithOwnership(agentId: string, userId: string) {
  const snap = await adminDb
    .collectionGroup('agents')
    .where('id', '==', agentId)
    .where('userId', '==', userId)
    .limit(1)
    .get()

  if (snap.empty) return null

  const doc = snap.docs[0]
  const pathParts = doc.ref.path.split('/')
  const tenantId = pathParts[1]

  return { agent: doc.data(), tenantId }
}

/**
 * PATCH /api/agents/[id]/chatwoot/connections/[connectionId]
 * Disconnect a Chatwoot connection.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: agentId, connectionId } = await params

    const auth = await requireAuth()
    if (!auth.ok) return auth.response

    const agentResult = await findAgentWithOwnership(agentId, auth.user.id)
    if (!agentResult) {
      return NextResponse.json(
        { error: 'Agent not found or unauthorized' },
        { status: 404 }
      )
    }

    const { tenantId } = agentResult

    const hasChatwoot = await isFeatureEnabled(tenantId, 'CHATWOOT')
    if (!hasChatwoot) {
      return NextResponse.json(
        { error: 'Chatwoot integration is not enabled for this tenant' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { action, reason } = body

    if (action === 'disconnect') {
      const connection = await getChatwootConnection(
        tenantId,
        agentId,
        connectionId
      )
      if (!connection) {
        return NextResponse.json(
          { error: 'Connection not found' },
          { status: 404 }
        )
      }

      // Remove agent bot from Chatwoot (best-effort)
      const apiToken = decryptToken(connection.encryptedApiToken)
      if (connection.agentBotId) {
        try {
          await unassignAgentBotFromInbox(
            connection.chatwootUrl,
            apiToken,
            connection.chatwootAccountId,
            connection.chatwootInboxId
          )
          await deleteChatwootAgentBot(
            connection.chatwootUrl,
            apiToken,
            connection.chatwootAccountId,
            connection.agentBotId
          )
        } catch {
          // Best-effort — don't block disconnect
        }
      }

      // Remove webhook from Chatwoot (best-effort)
      if (connection.chatwootWebhookId) {
        try {
          await deleteChatwootWebhook(
            connection.chatwootUrl,
            apiToken,
            connection.chatwootAccountId,
            connection.chatwootWebhookId
          )
        } catch {
          // Best-effort — don't block disconnect
        }
      }

      await disconnectChatwootConnection(
        tenantId,
        agentId,
        connectionId,
        reason
      )

      return NextResponse.json({ ok: true })
    }

    return NextResponse.json(
      { error: 'Invalid action' },
      { status: 400 }
    )
  } catch (error) {
    console.error('Error updating Chatwoot connection:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/agents/[id]/chatwoot/connections/[connectionId]
 * Permanently delete a Chatwoot connection and clean up webhook.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id: agentId, connectionId } = await params

    const auth = await requireAuth()
    if (!auth.ok) return auth.response

    const agentResult = await findAgentWithOwnership(agentId, auth.user.id)
    if (!agentResult) {
      return NextResponse.json(
        { error: 'Agent not found or unauthorized' },
        { status: 404 }
      )
    }

    const { tenantId } = agentResult

    const connection = await getChatwootConnection(
      tenantId,
      agentId,
      connectionId
    )
    if (!connection) {
      return NextResponse.json(
        { error: 'Connection not found' },
        { status: 404 }
      )
    }

    // Remove agent bot from Chatwoot (best-effort)
    const apiToken = decryptToken(connection.encryptedApiToken)
    if (connection.agentBotId) {
      try {
        await unassignAgentBotFromInbox(
          connection.chatwootUrl,
          apiToken,
          connection.chatwootAccountId,
          connection.chatwootInboxId
        )
        await deleteChatwootAgentBot(
          connection.chatwootUrl,
          apiToken,
          connection.chatwootAccountId,
          connection.agentBotId
        )
      } catch {
        // Best-effort
      }
    }

    // Remove webhook from Chatwoot (best-effort)
    if (connection.chatwootWebhookId) {
      try {
        await deleteChatwootWebhook(
          connection.chatwootUrl,
          apiToken,
          connection.chatwootAccountId,
          connection.chatwootWebhookId
        )
      } catch {
        // Best-effort
      }
    }

    await deleteChatwootConnection(tenantId, agentId, connectionId)

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Error deleting Chatwoot connection:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
