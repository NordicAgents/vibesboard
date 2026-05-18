import { NextRequest, NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/route-handler'
import { isFeatureEnabled } from '@vibesboard/policy/features'
import { listInboxAccounts } from '@vibesboard/channel-instagram/accounts'

export const runtime = 'nodejs'

/**
 * GET — List Instagram Inbox accounts for a tenant.
 */
type RouteParams = {
  params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: tenantId } = await params
    const authResult = await requireTenantMember(tenantId)
    if (!authResult.ok) return authResult.response

    const hasAccess = await isFeatureEnabled(tenantId, 'INSTAGRAM_INBOX')
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Instagram Inbox feature is not enabled' },
        { status: 403 }
      )
    }

    const accounts = await listInboxAccounts(tenantId)

    // Strip encrypted tokens from response
    const safeAccounts = accounts.map(({ accessToken, ...rest }) => rest)

    return NextResponse.json(safeAccounts)
  } catch (error: any) {
    console.error('List Instagram inbox accounts error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to list accounts' },
      { status: 500 }
    )
  }
}
