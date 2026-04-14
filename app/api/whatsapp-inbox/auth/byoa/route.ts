import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/firebase/route-handler'
import { isFeatureEnabled } from '@/lib/features'
import { getActiveTenant } from '@/lib/tenant-context'
import { connectByoaAccount } from '@/lib/whatsapp-inbox/accounts'

export const runtime = 'nodejs'

/**
 * POST — Connect a WhatsApp Business Account using BYOA (Bring Your Own App).
 *
 * Body: { metaAppId, metaAppSecret, accessToken, webhookVerifyToken, wabaId }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (!authResult.ok) return authResult.response

    const tenantId = await getActiveTenant(authResult.user.id)
    if (!tenantId) {
      return NextResponse.json({ error: 'No active tenant' }, { status: 400 })
    }

    const hasAccess = await isFeatureEnabled(tenantId, 'WHATSAPP_INBOX_BYOA')
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'WhatsApp BYOA feature is not enabled for your workspace' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const {
      metaAppId,
      metaAppSecret,
      accessToken,
      webhookVerifyToken,
      wabaId
    } = body

    // Validate required fields
    if (!metaAppId || typeof metaAppId !== 'string') {
      return NextResponse.json(
        { error: 'Meta App ID is required' },
        { status: 400 }
      )
    }

    if (!/^\d+$/.test(metaAppId.trim())) {
      return NextResponse.json(
        { error: 'Meta App ID must be a numeric string' },
        { status: 400 }
      )
    }

    if (!metaAppSecret || typeof metaAppSecret !== 'string') {
      return NextResponse.json(
        { error: 'Meta App Secret is required' },
        { status: 400 }
      )
    }

    if (!accessToken || typeof accessToken !== 'string') {
      return NextResponse.json(
        { error: 'Access token is required' },
        { status: 400 }
      )
    }

    if (!webhookVerifyToken || typeof webhookVerifyToken !== 'string') {
      return NextResponse.json(
        { error: 'Webhook verify token is required' },
        { status: 400 }
      )
    }

    if (!wabaId || typeof wabaId !== 'string') {
      return NextResponse.json(
        { error: 'WABA ID is required' },
        { status: 400 }
      )
    }

    if (!/^\d+$/.test(wabaId.trim())) {
      return NextResponse.json(
        { error: 'WABA ID must be a numeric string (e.g. "123456789012345")' },
        { status: 400 }
      )
    }

    const account = await connectByoaAccount({
      tenantId,
      metaAppId: metaAppId.trim(),
      metaAppSecret: metaAppSecret.trim(),
      accessToken: accessToken.trim(),
      webhookVerifyToken: webhookVerifyToken.trim(),
      wabaId: wabaId.trim(),
      userId: authResult.user.id
    })

    // Return account without encrypted secrets
    const {
      accessToken: _token,
      metaAppSecret: _secret,
      webhookVerifyToken: _vt,
      ...safeAccount
    } = account
    return NextResponse.json(safeAccount, { status: 201 })
  } catch (error: any) {
    console.error('BYOA connection error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to connect WhatsApp account via BYOA' },
      { status: 500 }
    )
  }
}
