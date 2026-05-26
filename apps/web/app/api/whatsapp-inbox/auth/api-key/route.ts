import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/route-handler'
import { isFeatureEnabled } from '@vibesboard/policy/features'
import { getActiveTenant } from '@/lib/tenant-context'
import { connectApiKeyAccount } from '@vibesboard/channel-whatsapp/accounts'

export const runtime = 'nodejs'

/**
 * POST — Connect a WhatsApp Business Account using a System User access token.
 *
 * Body: { accessToken: string, wabaId: string }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (!authResult.ok) return authResult.response

    const tenantId = await getActiveTenant(authResult.user.id)
    if (!tenantId) {
      return NextResponse.json({ error: 'No active tenant' }, { status: 400 })
    }

    const hasAccess = await isFeatureEnabled(tenantId, 'WHATSAPP_INBOX_API_KEY')
    if (!hasAccess) {
      return NextResponse.json(
        {
          error: 'WhatsApp API Key connection is not enabled for your workspace'
        },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { accessToken, wabaId } = body

    if (!accessToken || typeof accessToken !== 'string') {
      return NextResponse.json(
        { error: 'Access token is required' },
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

    const account = await connectApiKeyAccount({
      tenantId,
      accessToken: accessToken.trim(),
      wabaId: wabaId.trim(),
      userId: authResult.user.id
    })

    const { accessToken: _token, ...safeAccount } = account
    return NextResponse.json(safeAccount, { status: 201 })
  } catch (error: any) {
    console.error('API key connection error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to connect WhatsApp account' },
      { status: 500 }
    )
  }
}
