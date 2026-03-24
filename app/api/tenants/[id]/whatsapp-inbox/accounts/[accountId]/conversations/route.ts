import { NextRequest, NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/firebase/route-handler'
import { isFeatureEnabled } from '@/lib/features'
import { listConversations } from '@/lib/whatsapp-inbox/conversations'
import type { InboxConversationStatus } from '@/lib/firestore-types'

export const runtime = 'nodejs'

/**
 * GET — List conversations for an inbox account.
 * Query params: ?status=open|resolved|snoozed
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; accountId: string } }
) {
  try {
    const { id: tenantId, accountId } = params
    const authResult = await requireTenantMember(tenantId)
    if (!authResult.ok) return authResult.response

    const hasAccess = await isFeatureEnabled(tenantId, 'WHATSAPP_INBOX')
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'WhatsApp Inbox feature is not enabled' },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') as InboxConversationStatus | null

    const conversations = await listConversations(
      tenantId,
      accountId,
      status || undefined
    )

    return NextResponse.json(conversations)
  } catch (error: any) {
    console.error('List conversations error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to list conversations' },
      { status: 500 }
    )
  }
}
