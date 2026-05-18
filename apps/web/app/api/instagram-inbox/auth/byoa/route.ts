import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/route-handler'
import { isFeatureEnabled } from '@vibesboard/policy/features'
import { getActiveTenant } from '@/lib/tenant-context'
import { connectByoaAccount } from '@vibesboard/channel-instagram/accounts'

export const runtime = 'nodejs'

/**
 * POST — Connect an Instagram account using BYOA (Bring Your Own App).
 *
 * Body: { metaAppId, metaAppSecret, accessToken, webhookVerifyToken, pageId }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (!authResult.ok) return authResult.response

    const tenantId = await getActiveTenant(authResult.user.id)
    if (!tenantId) {
      return NextResponse.json({ error: 'No active tenant' }, { status: 400 })
    }

    const hasAccess = await isFeatureEnabled(tenantId, 'INSTAGRAM_INBOX_BYOA')
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Instagram BYOA feature is not enabled for your workspace' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const {
      metaAppId,
      metaAppSecret,
      accessToken,
      webhookVerifyToken,
      pageId
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

    if (!pageId || typeof pageId !== 'string') {
      return NextResponse.json(
        { error: 'Facebook Page ID is required' },
        { status: 400 }
      )
    }

    if (!/^\d+$/.test(pageId.trim())) {
      return NextResponse.json(
        { error: 'Page ID must be a numeric string' },
        { status: 400 }
      )
    }

    const account = await connectByoaAccount({
      tenantId,
      metaAppId: metaAppId.trim(),
      metaAppSecret: metaAppSecret.trim(),
      accessToken: accessToken.trim(),
      webhookVerifyToken: webhookVerifyToken.trim(),
      pageId: pageId.trim(),
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
      {
        error: error.message || 'Failed to connect Instagram account via BYOA'
      },
      { status: 500 }
    )
  }
}
