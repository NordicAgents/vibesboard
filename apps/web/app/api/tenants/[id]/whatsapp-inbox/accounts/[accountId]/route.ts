import { NextRequest, NextResponse } from 'next/server'
import {
  requireTenantMember,
  requireTenantAdmin
} from '@/lib/auth/route-handler'
import { isFeatureEnabled } from '@vibesboard/policy/features'
import { adminDb } from '@vibesboard/adapter-firebase/admin'
import { Collections } from '@vibesboard/contracts'
import { getAgentForMember } from '@vibesboard/agents/server'
import {
  getInboxAccount,
  disconnectInboxAccount
} from '@vibesboard/channel-whatsapp/accounts'

export const runtime = 'nodejs'

/**
 * GET — Get a single inbox account.
 */
type RouteParams = {
  params: Promise<{ id: string; accountId: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: tenantId, accountId } = await params
    const authResult = await requireTenantMember(tenantId)
    if (!authResult.ok) return authResult.response

    const hasAccess = await isFeatureEnabled(tenantId, 'WHATSAPP_INBOX')
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'WhatsApp Inbox feature is not enabled' },
        { status: 403 }
      )
    }

    const account = await getInboxAccount(tenantId, accountId)
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    // Strip encrypted token
    const { accessToken, ...safeAccount } = account
    return NextResponse.json(safeAccount)
  } catch (error: any) {
    console.error('Get inbox account error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to get account' },
      { status: 500 }
    )
  }
}

/**
 * DELETE — Disconnect an inbox account.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: tenantId, accountId } = await params
    const authResult = await requireTenantAdmin(tenantId)
    if (!authResult.ok) return authResult.response

    const hasAccess = await isFeatureEnabled(tenantId, 'WHATSAPP_INBOX')
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'WhatsApp Inbox feature is not enabled' },
        { status: 403 }
      )
    }

    await disconnectInboxAccount(tenantId, accountId)
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Disconnect inbox account error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to disconnect account' },
      { status: 500 }
    )
  }
}

/**
 * PATCH — Update account settings (agent assignment).
 * Body: { assignedAgentId?, agentAutoReply? }
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: tenantId, accountId } = await params
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
    const updates: Record<string, any> = {
      updatedAt: new Date().toISOString()
    }

    if (body.assignedAgentId !== undefined) {
      if (body.assignedAgentId) {
        const agent = await getAgentForMember(tenantId, body.assignedAgentId)
        if (!agent) {
          return NextResponse.json(
            { error: 'Agent not found' },
            { status: 404 }
          )
        }
      }
      updates.assignedAgentId = body.assignedAgentId || null
      // Default agentAutoReply to true when assigning an agent
      if (body.agentAutoReply === undefined && body.assignedAgentId) {
        updates.agentAutoReply = true
      }
    }

    if (body.agentAutoReply !== undefined) {
      updates.agentAutoReply = body.agentAutoReply
    }

    const accountPath = Collections.whatsappInboxAccounts(tenantId)
    await adminDb.collection(accountPath).doc(accountId).update(updates)

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Update inbox account error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to update account' },
      { status: 500 }
    )
  }
}
