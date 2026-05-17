import { NextRequest, NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/firebase/route-handler'
import { isFeatureEnabled } from '@vibesboard/policy/features'
import { listMessages, sendReply } from '@vibesboard/channel-instagram/messages'

export const runtime = 'nodejs'

type RouteParams = {
  params: Promise<{ id: string; accountId: string; contactId: string }>
}

/**
 * GET — List messages for a conversation.
 * Query params: ?limit=50&before=ISO_TIMESTAMP
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
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

    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100)
    const before = searchParams.get('before') || undefined

    const messages = await listMessages(
      tenantId,
      accountId,
      contactId,
      limit,
      before
    )

    return NextResponse.json(messages)
  } catch (error: any) {
    console.error('List Instagram messages error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to list messages' },
      { status: 500 }
    )
  }
}

/**
 * POST — Send a reply message.
 * Body: { text: string }
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
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
    const { text } = body

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return NextResponse.json(
        { error: 'Message text is required' },
        { status: 400 }
      )
    }

    if (text.length > 1000) {
      return NextResponse.json(
        { error: 'Message text cannot exceed 1000 characters' },
        { status: 400 }
      )
    }

    const message = await sendReply({
      tenantId,
      accountId,
      contactIgsid: contactId,
      text: text.trim(),
      userId: authResult.user.id
    })

    return NextResponse.json(message, { status: 201 })
  } catch (error: any) {
    console.error('Send Instagram reply error:', error)

    // Return 400 for window expired errors
    if (error.message?.includes('24-hour')) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json(
      { error: error.message || 'Failed to send message' },
      { status: 500 }
    )
  }
}
