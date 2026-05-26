import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/route-handler'

export const runtime = 'nodejs'

type RouteParams = {
  params: Promise<{ id: string }>
}

/**
 * GET /api/tenants/[id]/usage
 * Returns usage data for the current billing cycle.
 *
 * The legacy Firestore `usageRollups`/`usageLogs` collections and the tenant
 * `subscription` field are no longer written (self-host `recordUsage` is a
 * no-op shim, and Postgres `tenants` has no subscription column). The route
 * stays alive returning a truthful empty/zero shape so the UI does not 500.
 */
export async function GET(req: Request, { params }: RouteParams) {
  const { id: tenantId } = await params

  const auth = await requireTenantMember(tenantId)
  if (!auth.ok) return auth.response

  const now = new Date()
  const billingCycleId = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  return NextResponse.json({
    subscription: null,
    rollup: null,
    dailyUsage: [],
    billingCycleId
  })
}
