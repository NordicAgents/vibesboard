import { NextRequest, NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/firebase/route-handler'
import { isFeatureEnabled } from '@/lib/features'
import { listInboxAccounts } from '@/lib/instagram-inbox/accounts'

export const runtime = 'nodejs'

/**
 * GET — List Instagram Inbox accounts for a tenant.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const tenantId = params.id
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
