import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/firebase/route-handler'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import {
  findConnectionById,
  disconnectConnection,
  updateConnection,
  resetConnection
} from '@/lib/whatsapp/connections'
import { resendIntroductionMessage } from '@/lib/whatsapp/intro-message'
import { isFeatureEnabled } from '@/lib/features'
import { z } from 'zod'

export const runtime = 'nodejs'

const DisconnectSchema = z.object({
  conversationAction: z.enum(['keep', 'archive', 'delete']).default('keep'),
  reason: z.string().optional()
})

const ReconnectSchema = z.object({
  sendIntroMessage: z.boolean().default(true)
})

type RouteParams = {
  params: Promise<{ id: string; connectionId: string }>
}

/**
 * Find an agent by ID using collectionGroup query, verifying ownership.
 * Returns the agent data and tenantId, or null if not found / not owned.
 */
async function findAgentWithOwnership(agentId: string, userId: string) {
  const snap = await adminDb
    .collectionGroup('agents')
    .where('id', '==', agentId)
    .where('userId', '==', userId)
    .limit(1)
    .get()

  if (snap.empty) return null

  const doc = snap.docs[0]
  // Path: tenants/{tenantId}/agents/{agentId}
  const pathParts = doc.ref.path.split('/')
  const tenantId = pathParts[1]

  return { agent: doc.data(), tenantId, ref: doc.ref }
}

/**
 * GET /api/agents/[id]/whatsapp/connections/[connectionId]
 * Get connection details
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id: agentId, connectionId } = await params

    const auth = await requireAuth()
    if (!auth.ok) return auth.response

    // Verify agent ownership
    const agentResult = await findAgentWithOwnership(agentId, auth.user.id)
    if (!agentResult) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { tenantId } = agentResult

    // Check feature flag
    const hasWhatsApp = await isFeatureEnabled(tenantId, 'WHATSAPP_MESSAGING')
    if (!hasWhatsApp) {
      return NextResponse.json(
        { error: 'WhatsApp Messaging is not enabled for this tenant' },
        { status: 403 }
      )
    }

    const connection = await findConnectionById(tenantId, agentId, connectionId)

    if (!connection) {
      return NextResponse.json(
        { error: 'Connection not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ connection })
  } catch (error) {
    console.error('Error fetching connection:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/agents/[id]/whatsapp/connections/[connectionId]
 * Update connection (disconnect, reconnect, etc.)
 */
export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id: agentId, connectionId } = await params

    const auth = await requireAuth()
    if (!auth.ok) return auth.response

    // Verify ownership
    const agentResult = await findAgentWithOwnership(agentId, auth.user.id)
    if (!agentResult) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { agent, tenantId } = agentResult

    // Check feature flag
    const hasWhatsApp = await isFeatureEnabled(tenantId, 'WHATSAPP_MESSAGING')
    if (!hasWhatsApp) {
      return NextResponse.json(
        { error: 'WhatsApp Messaging is not enabled for this tenant' },
        { status: 403 }
      )
    }

    const connection = await findConnectionById(tenantId, agentId, connectionId)

    if (!connection) {
      return NextResponse.json(
        { error: 'Connection not found' },
        { status: 404 }
      )
    }

    const body = await request.json()
    const action = body.action as string

    // Handle different actions
    switch (action) {
      case 'disconnect': {
        const validated = DisconnectSchema.parse(body)

        // Handle conversation cleanup
        const conversationsRef = adminDb.collection(
          Collections.conversations(tenantId, agentId)
        )

        if (validated.conversationAction === 'delete') {
          // Delete conversations linked to this connection
          const convSnap = await conversationsRef
            .where('externalId', '==', connectionId)
            .get()
          const batch = adminDb.batch()
          convSnap.docs.forEach(doc => batch.delete(doc.ref))
          if (!convSnap.empty) await batch.commit()
        } else if (validated.conversationAction === 'archive') {
          const convSnap = await conversationsRef
            .where('externalId', '==', connectionId)
            .get()
          const batch = adminDb.batch()
          convSnap.docs.forEach(doc =>
            batch.update(doc.ref, { closedAt: new Date().toISOString() })
          )
          if (!convSnap.empty) await batch.commit()
        }

        const updated = await disconnectConnection(
          tenantId,
          agentId,
          connectionId,
          validated.reason
        )

        return NextResponse.json({
          connection: updated,
          message: 'Connection disconnected successfully'
        })
      }

      case 'reconnect': {
        const validated = ReconnectSchema.parse(body)

        // Update connection to active and clear disconnection fields
        const connRef = adminDb
          .collection(Collections.whatsappConnections(tenantId, agentId))
          .doc(connectionId)

        await connRef.update({
          status: 'active',
          connectedAt: new Date().toISOString(),
          disconnectedAt: null,
          disconnectionReason: null,
          updatedAt: new Date().toISOString()
        })

        // Get updated connection
        const updatedSnap = await connRef.get()
        const updated = updatedSnap.exists
          ? { id: updatedSnap.id, ...updatedSnap.data() }
          : null

        // Optionally resend intro
        if (validated.sendIntroMessage) {
          await resendIntroductionMessage(connectionId, agent as any)
        }

        return NextResponse.json({
          connection: updated,
          message: 'Connection reconnected successfully'
        })
      }

      case 'reset': {
        await resetConnection(tenantId, agentId, connectionId)

        return NextResponse.json({
          message: 'Connection reset successfully. All conversations closed.'
        })
      }

      case 'resend_intro': {
        const sent = await resendIntroductionMessage(connectionId, agent as any)

        if (!sent) {
          return NextResponse.json(
            { error: 'Failed to send introduction message' },
            { status: 500 }
          )
        }

        return NextResponse.json({
          message: 'Introduction message resent successfully'
        })
      }

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
  } catch (error) {
    console.error('Error updating connection:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/agents/[id]/whatsapp/connections/[connectionId]
 * Permanently delete connection
 */
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id: agentId, connectionId } = await params

    const auth = await requireAuth()
    if (!auth.ok) return auth.response

    // Verify ownership
    const agentResult = await findAgentWithOwnership(agentId, auth.user.id)
    if (!agentResult) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { tenantId } = agentResult

    // Check feature flag
    const hasWhatsApp = await isFeatureEnabled(tenantId, 'WHATSAPP_MESSAGING')
    if (!hasWhatsApp) {
      return NextResponse.json(
        { error: 'WhatsApp Messaging is not enabled for this tenant' },
        { status: 403 }
      )
    }

    const connection = await findConnectionById(tenantId, agentId, connectionId)

    if (!connection) {
      return NextResponse.json(
        { error: 'Connection not found' },
        { status: 404 }
      )
    }

    // Delete connection document
    await adminDb
      .collection(Collections.whatsappConnections(tenantId, agentId))
      .doc(connectionId)
      .delete()

    return NextResponse.json({
      message: 'Connection deleted successfully'
    })
  } catch (error) {
    console.error('Error deleting connection:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
