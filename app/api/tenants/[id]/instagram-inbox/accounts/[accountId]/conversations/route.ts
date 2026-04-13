import { NextRequest, NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/firebase/route-handler'
import { isFeatureEnabled } from '@/lib/features'
import { listConversations } from '@/lib/instagram-inbox/conversations'
import type { InboxConversationStatus } from '@/lib/firestore-types'

export const runtime = 'nodejs'

/**
 * GET — List conversations for an inbox account.
 * Query params: ?status=open|resolved|snoozed
 */
type RouteParams = {
  params: Promise<{ id: string; accountId: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
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

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') as InboxConversationStatus | null

    const conversations = await listConversations(
      tenantId,
      accountId,
      status || undefined
    )

    return NextResponse.json(conversations)
  } catch (error: any) {
    console.error('List Instagram conversations error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to list conversations' },
      { status: 500 }
    )
  }
}
