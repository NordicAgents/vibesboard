import { NextRequest, NextResponse } from 'next/server'
import { requireTenantMember, requireTenantAdmin } from '@/lib/firebase/route-handler'
import { isFeatureEnabled } from '@/lib/features'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { getAgentForMember } from '@/lib/agents/server'
import {
  getInboxAccount,
  disconnectInboxAccount,
  deleteInboxAccount,
} from '@/lib/instagram-inbox/accounts'

export const runtime = 'nodejs'

type RouteParams = {
  params: Promise<{ id: string; accountId: string }>
}

/**
 * GET — Get a single inbox account.
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id: tenantId, accountId } = await params
    const authResult = await requireTenantMember(tenantId)
    if (!authResult.ok) return authResult.response

    const hasAccess = await isFeatureEnabled(tenantId, 'INSTAGRAM_INBOX')
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Instagram Inbox feature is not enabled' },
        { status: 403 }
      )
    }

    const account = await getInboxAccount(tenantId, accountId)
    if (!account) {
      return NextResponse.json(
        { error: 'Account not found' },
        { status: 404 }
      )
    }

    // Strip encrypted token
    const { accessToken, ...safeAccount } = account
    return NextResponse.json(safeAccount)
  } catch (error: any) {
    console.error('Get Instagram inbox account error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to get account' },
      { status: 500 }
    )
  }
}

/**
 * DELETE — Disconnect an inbox account.
 */
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id: tenantId, accountId } = await params
    const authResult = await requireTenantAdmin(tenantId)
    if (!authResult.ok) return authResult.response

    const hasAccess = await isFeatureEnabled(tenantId, 'INSTAGRAM_INBOX')
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Instagram Inbox feature is not enabled' },
        { status: 403 }
      )
    }

    const account = await getInboxAccount(tenantId, accountId)
    if (!account) {
      return NextResponse.json(
        { error: 'Account not found' },
        { status: 404 }
      )
    }

    if (account.status === 'disconnected') {
      // Already disconnected — permanently delete the record
      await deleteInboxAccount(tenantId, accountId)
    } else {
      // Active account — soft-delete (disconnect)
      await disconnectInboxAccount(tenantId, accountId)
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Delete/disconnect Instagram inbox account error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to remove account' },
      { status: 500 }
    )
  }
}

/**
 * PATCH — Update account settings (agent assignment).
 * Body: { assignedAgentId?, agentAutoReply? }
 */
export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id: tenantId, accountId } = await params
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
    const updates: Record<string, any> = {
      updatedAt: new Date().toISOString(),
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
      if (body.agentAutoReply === undefined && body.assignedAgentId) {
        updates.agentAutoReply = true
      }
    }

    if (body.agentAutoReply !== undefined) {
      updates.agentAutoReply = body.agentAutoReply
    }

    const accountPath = Collections.instagramInboxAccounts(tenantId)
    await adminDb.collection(accountPath).doc(accountId).update(updates)

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Update Instagram inbox account error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to update account' },
      { status: 500 }
    )
  }
}
