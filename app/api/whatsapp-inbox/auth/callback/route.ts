import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/firebase/route-handler'
import { isFeatureEnabled } from '@/lib/features'
import { getActiveTenant } from '@/lib/tenant-context'
import { connectOAuthAccount } from '@/lib/whatsapp-inbox/accounts'

export const runtime = 'nodejs'

/**
 * POST — Exchange OAuth authorization code for an access token
 * and connect the WhatsApp Business Account.
 *
 * Body: { code: string }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (!authResult.ok) return authResult.response

    const tenantId = await getActiveTenant(authResult.user.id)
    if (!tenantId) {
      return NextResponse.json(
        { error: 'No active tenant' },
        { status: 400 }
      )
    }

    const hasAccess = await isFeatureEnabled(tenantId, 'WHATSAPP_INBOX_OAUTH')
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'WhatsApp OAuth connection is not enabled for your workspace' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { code } = body

    if (!code || typeof code !== 'string') {
      return NextResponse.json(
        { error: 'Authorization code is required' },
        { status: 400 }
      )
    }

    const account = await connectOAuthAccount({
      tenantId,
      code,
      userId: authResult.user.id,
    })

    const { accessToken, ...safeAccount } = account
    return NextResponse.json(safeAccount, { status: 201 })
  } catch (error: any) {
    console.error('OAuth callback error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to connect WhatsApp account' },
      { status: 500 }
    )
  }
}
