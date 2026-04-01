import { NextRequest, NextResponse } from 'next/server'
import { requireTenantMember, requireTenantAdmin } from '@/lib/firebase/route-handler'
import { isFeatureEnabled } from '@/lib/features'
import {
  getInboxAccount,
  disconnectInboxAccount,
} from '@/lib/whatsapp-inbox/accounts'

export const runtime = 'nodejs'

/**
 * GET — Get a single inbox account.
 */
type RouteParams = {
  params: Promise<{ id: string; accountId: string }>
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
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
      return NextResponse.json(
        { error: 'Account not found' },
        { status: 404 }
      )
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
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
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
