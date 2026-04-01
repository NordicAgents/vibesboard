import { NextRequest, NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/firebase/route-handler'
import { isFeatureEnabled } from '@/lib/features'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import {
  getConversation,
  updateConversationStatus,
  assignConversation,
  markAsRead,
} from '@/lib/instagram-inbox/conversations'
import type { InboxConversationStatus } from '@/lib/firestore-types'

export const runtime = 'nodejs'

type RouteParams = {
  params: Promise<{ id: string; accountId: string; contactId: string }>
}

/**
 * GET — Get a single conversation.
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id: tenantId, accountId, contactId } = await params
    const authResult = await requireTenantMember(tenantId)
    if (!authResult.ok) return authResult.response

    const hasAccess = await isFeatureEnabled(tenantId, 'INSTAGRAM_INBOX')
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Instagram Inbox feature is not enabled' },
        { status: 403 }
      )
    }

    const conversation = await getConversation(tenantId, accountId, contactId)
    if (!conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(conversation)
  } catch (error: any) {
    console.error('Get Instagram conversation error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to get conversation' },
      { status: 500 }
    )
  }
}

/**
 * PATCH — Update conversation (status, assignee, mark as read).
 * Body: { status?, assignedTo?, markAsRead? }
 */
export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id: tenantId, accountId, contactId } = await params
    const authResult = await requireTenantMember(tenantId)
    if (!authResult.ok) return authResult.response

    const hasAccess = await isFeatureEnabled(tenantId, 'INSTAGRAM_INBOX')
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Instagram Inbox feature is not enabled' },
        { status: 403 }
      )
    }

    const body = await request.json()

    if (body.status) {
      const validStatuses: InboxConversationStatus[] = [
        'open',
        'resolved',
        'snoozed',
      ]
      if (!validStatuses.includes(body.status)) {
        return NextResponse.json(
          { error: 'Invalid status. Must be: open, resolved, or snoozed' },
          { status: 400 }
        )
      }
      await updateConversationStatus(tenantId, accountId, contactId, body.status)
    }

    if (body.assignedTo !== undefined) {
      await assignConversation(
        tenantId,
        accountId,
        contactId,
        body.assignedTo
      )
    }

    if (body.markAsRead) {
      await markAsRead(tenantId, accountId, contactId)
    }

    // Agent assignment fields
    const agentUpdates: Record<string, any> = {}

    if (body.assignedAgentId !== undefined) {
      agentUpdates.assignedAgentId = body.assignedAgentId || null
    }

    if (body.agentPaused !== undefined) {
      agentUpdates.agentPaused = body.agentPaused
    }

    if (body.agentHandedOff !== undefined) {
      agentUpdates.agentHandedOff = body.agentHandedOff
      // When re-engaging agent, also reset the agent conversation handoff flag
      if (body.agentHandedOff === false) {
        const convo = await getConversation(tenantId, accountId, contactId)
        if (convo?.agentConversationId) {
          const effectiveAgentId = convo.assignedAgentId || null
          if (effectiveAgentId) {
            const agentConvoPath = Collections.conversations(tenantId, effectiveAgentId)
            await adminDb.collection(agentConvoPath).doc(convo.agentConversationId).update({
              handedOff: false,
              updatedAt: new Date().toISOString(),
            }).catch(() => {}) // Non-critical
          }
        }
      }
    }

    if (Object.keys(agentUpdates).length > 0) {
      const convoPath = Collections.instagramInboxConversations(tenantId, accountId)
      await adminDb.collection(convoPath).doc(contactId).update({
        ...agentUpdates,
        updatedAt: new Date().toISOString(),
      })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Update Instagram conversation error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to update conversation' },
      { status: 500 }
    )
  }
}
