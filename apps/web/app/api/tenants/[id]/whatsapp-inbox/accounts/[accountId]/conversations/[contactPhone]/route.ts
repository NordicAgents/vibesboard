import { NextRequest, NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/route-handler'
import { isFeatureEnabled } from '@vibesboard/policy/features'
import {
  getConversation,
  updateConversationStatus,
  assignConversation,
  markAsRead,
  updateConversationAgentSettings
} from '@vibesboard/channel-whatsapp/conversations'
import { resumeConversation } from '@vibesboard/agents/conversations'
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
 * Apply agent-related conversation updates (assignment, pause, handoff).
 * Extracted from PATCH to keep that handler's complexity manageable.
 */
async function applyAgentConversationUpdates(
  tenantId: string,
  accountId: string,
  contactPhone: string,
  body: {
    assignedAgentId?: string | null
    agentPaused?: boolean
    agentHandedOff?: boolean
  }
): Promise<void> {
  const agentUpdates: {
    assignedAgentId?: string | null
    agentPaused?: boolean
    agentHandedOff?: boolean
  } = {}

  if (body.assignedAgentId !== undefined) {
    agentUpdates.assignedAgentId = body.assignedAgentId || null
  }
  if (body.agentPaused !== undefined) {
    agentUpdates.agentPaused = body.agentPaused
  }
  if (body.agentHandedOff !== undefined) {
    agentUpdates.agentHandedOff = body.agentHandedOff
  }

  if (Object.keys(agentUpdates).length === 0) return

  await updateConversationAgentSettings(
    tenantId,
    accountId,
    contactPhone,
    agentUpdates
  )

  // When re-engaging the agent, reset the linked core conversation flag.
  if (body.agentHandedOff === false) {
    const convo = await getConversation(tenantId, accountId, contactPhone)
    const effectiveAgentId = convo?.assignedAgentId || null
    if (convo?.agentConversationId && effectiveAgentId) {
      // The agent-side conversation lives in the core (Postgres) table.
      await resumeConversation(
        tenantId,
        effectiveAgentId,
        convo.agentConversationId
      ).catch(() => {}) // Non-critical
    }
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

    await applyAgentConversationUpdates(tenantId, accountId, contactPhone, body)

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Update conversation error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to update conversation' },
      { status: 500 }
    )
  }
}
