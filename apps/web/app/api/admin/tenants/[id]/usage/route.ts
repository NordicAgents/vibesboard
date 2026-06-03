import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/route-handler'

export const runtime = 'nodejs'

type RouteParams = {
  params: Promise<{ id: string }>
}

/**
 * GET /api/admin/tenants/[id]/usage
 * Returns usage data for any tenant (SUPER_ADMIN only).
 *
 * The legacy `usageRollups`/`usageLogs` rollups and the tenant
 * `subscription` field are no longer written (self-host `recordUsage` is a
 * no-op shim, and Postgres `tenants` has no subscription column). The route
 * stays alive returning a truthful empty/zero shape so the admin UI does not
 * 500.
 */
export async function GET(req: Request, { params }: RouteParams) {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response

  // tenantId is unused now (no per-tenant rollup remains) but the param is
  // part of the route contract.
  await params

  const now = new Date()
  const billingCycleId = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  return NextResponse.json({
    subscription: null,
    rollup: null,
    agentNames: {},
    userNames: {},
    dailyUsage: [],
    billingCycleId
  })
}
