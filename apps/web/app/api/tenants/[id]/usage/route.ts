import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/route-handler'
import { getUsageRollup } from '@vibesboard/policy/usage'

export const runtime = 'nodejs'

type RouteParams = {
  params: Promise<{ id: string }>
}

/**
 * GET /api/tenants/[id]/usage
 * Returns usage data for the current billing cycle.
 *
 * Self-hosted deployments track monthly message/token totals in Postgres.
 * Billing/subscription data remains null because this repository does not
 * include a billing provider.
 */
export async function GET(req: Request, { params }: RouteParams) {
  const { id: tenantId } = await params

  const auth = await requireTenantMember(tenantId)
  if (!auth.ok) return auth.response

  const now = new Date()
  const billingCycleId = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const usage = await getUsageRollup({ tenantId, now })

  return NextResponse.json({
    subscription: null,
    rollup: {
      tenantId,
      billingCycleId,
      ...usage,
      byModel: {},
      byUser: {},
      updatedAt: now.toISOString()
    },
    dailyUsage: [],
    billingCycleId
  })
}
