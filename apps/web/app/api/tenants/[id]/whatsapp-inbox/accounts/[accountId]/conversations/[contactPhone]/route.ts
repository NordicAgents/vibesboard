import { NextRequest, NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/route-handler'
import { isFeatureEnabled } from '@vibesboard/policy/features'
import { adminDb } from '@vibesboard/adapter-firebase/admin'
import { Collections } from '@vibesboard/contracts'
import {
  getConversation,
  updateConversationStatus,
  assignConversation,
  markAsRead
} from '@vibesboard/channel-whatsapp/conversations'
import type { InboxConversationStatus } from '@vibesboard/contracts'

export const runtime = 'nodejs'

/**
 * GET — Get a single conversation.
 */
type RouteParams = {
  params: Promise<{ id: string; accountId: string; contactPhone: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: tenantId, accountId, contactPhone } = await params
    const authResult = await requireTenantMember(tenantId)
    if (!authResult.ok) return authResult.response

    const hasAccess = await isFeatureEnabled(tenantId, 'WHATSAPP_INBOX')
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'WhatsApp Inbox feature is not enabled' },
        { status: 403 }
      )
    }

    const conversation = await getConversation(
      tenantId,
      accountId,
      contactPhone
    )
    if (!conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(conversation)
  } catch (error: any) {
    console.error('Get conversation error:', error)
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
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: tenantId, accountId, contactPhone } = await params
    const authResult = await requireTenantMember(tenantId)
    if (!authResult.ok) return authResult.response

    const hasAccess = await isFeatureEnabled(tenantId, 'WHATSAPP_INBOX')
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'WhatsApp Inbox feature is not enabled' },
        { status: 403 }
      )
    }

    const body = await request.json()

    if (body.status) {
      const validStatuses: InboxConversationStatus[] = [
        'open',
        'resolved',
        'snoozed'
      ]
      if (!validStatuses.includes(body.status)) {
        return NextResponse.json(
          { error: 'Invalid status. Must be: open, resolved, or snoozed' },
          { status: 400 }
        )
      }
      await updateConversationStatus(
        tenantId,
        accountId,
        contactPhone,
        body.status
      )
    }

    if (body.assignedTo !== undefined) {
      await assignConversation(
        tenantId,
        accountId,
        contactPhone,
        body.assignedTo
      )
    }

    if (body.markAsRead) {
      await markAsRead(tenantId, accountId, contactPhone)
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
        const convo = await getConversation(tenantId, accountId, contactPhone)
        if (convo?.agentConversationId) {
          // Find the agent to get the correct collection path
          // The agentConversationId links to agents/{agentId}/conversations/{conversationId}
          // We need the agentId — resolve from account or conversation
          const effectiveAgentId = convo.assignedAgentId || null
          if (effectiveAgentId) {
            const agentConvoPath = Collections.conversations(
              tenantId,
              effectiveAgentId
            )
            await adminDb
              .collection(agentConvoPath)
              .doc(convo.agentConversationId)
              .update({
                handedOff: false,
                updatedAt: new Date().toISOString()
              })
              .catch(() => {}) // Non-critical
          }
        }
      }
    }

    if (Object.keys(agentUpdates).length > 0) {
      const phoneNormalized = contactPhone.replace(/\D/g, '')
      const convoPath = Collections.whatsappInboxConversations(
        tenantId,
        accountId
      )
      await adminDb
        .collection(convoPath)
        .doc(phoneNormalized)
        .update({
          ...agentUpdates,
          updatedAt: new Date().toISOString()
        })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Update conversation error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to update conversation' },
      { status: 500 }
    )
  }
}
