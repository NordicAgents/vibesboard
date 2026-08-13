import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/route-handler'
import { eq } from 'drizzle-orm'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { agents } from '@vibesboard/adapter-postgres/schema'
import { getUsageRollup } from '@vibesboard/policy/usage'

export const runtime = 'nodejs'

type RouteParams = {
  params: Promise<{ id: string }>
}

/**
 * GET /api/admin/tenants/[id]/usage
 * Returns usage data for any tenant (SUPER_ADMIN only).
 *
 * Billing/subscription data remains null in the self-hosted build, while
 * monthly message/token totals are read from Postgres.
 */
export async function GET(req: Request, { params }: RouteParams) {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response

  const { id: tenantId } = await params

  const now = new Date()
  const billingCycleId = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const db = getMigrateDb()
  const [usage, agentRows] = await Promise.all([
    getUsageRollup({ tenantId, now, db }),
    db
      .select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(eq(agents.tenantId, tenantId))
  ])

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
    agentNames: Object.fromEntries(agentRows.map(row => [row.id, row.name])),
    userNames: {},
    dailyUsage: [],
    billingCycleId
  })
}
