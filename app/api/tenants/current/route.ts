import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getActiveTenant } from '@/lib/tenant-context'

/**
 * GET - Get current active tenant ID for the authenticated user
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const tenantId = await getActiveTenant(session.user.id)

    if (!tenantId) {
      return NextResponse.json(
        { error: 'No active tenant found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ tenantId })
  } catch (error: any) {
    console.error('Failed to get current tenant:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to get current tenant' },
      { status: 500 }
    )
  }
}
