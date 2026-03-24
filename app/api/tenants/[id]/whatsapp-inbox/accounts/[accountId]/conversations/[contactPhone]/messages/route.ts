import { NextRequest, NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/firebase/route-handler'
import { isFeatureEnabled } from '@/lib/features'
import { listMessages, sendReply } from '@/lib/whatsapp-inbox/messages'

export const runtime = 'nodejs'

/**
 * GET — List messages for a conversation.
 * Query params: ?limit=50&before=ISO_TIMESTAMP
 */
export async function GET(
  request: NextRequest,
  {
    params,
  }: { params: { id: string; accountId: string; contactPhone: string } }
) {
  try {
    const { id: tenantId, accountId, contactPhone } = params
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
    const limit = Math.min(
      parseInt(searchParams.get('limit') || '50', 10),
      100
    )
    const before = searchParams.get('before') || undefined

    const messages = await listMessages(
      tenantId,
      accountId,
      contactPhone,
      limit,
      before
    )

    return NextResponse.json(messages)
  } catch (error: any) {
    console.error('List messages error:', error)
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
export async function POST(
  request: NextRequest,
  {
    params,
  }: { params: { id: string; accountId: string; contactPhone: string } }
) {
  try {
    const { id: tenantId, accountId, contactPhone } = params
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
    const { text } = body

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return NextResponse.json(
        { error: 'Message text is required' },
        { status: 400 }
      )
    }

    if (text.length > 4096) {
      return NextResponse.json(
        { error: 'Message text cannot exceed 4096 characters' },
        { status: 400 }
      )
    }

    const message = await sendReply({
      tenantId,
      accountId,
      contactPhone,
      text: text.trim(),
      userId: authResult.user.id,
    })

    return NextResponse.json(message, { status: 201 })
  } catch (error: any) {
    console.error('Send reply error:', error)

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
