import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/firebase/route-handler'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import type { TenantSubscription, UsageRollupDocument } from '@/lib/firestore-types'

export const runtime = 'nodejs'

type RouteParams = {
  params: Promise<{ id: string }>
}

/**
 * GET /api/tenants/[id]/usage
 * Returns usage data for the current billing cycle.
 */
export async function GET(req: Request, { params }: RouteParams) {
  const { id: tenantId } = await params

  const auth = await requireTenantMember(tenantId)
  if (!auth.ok) return auth.response

  // 1. Read tenant subscription
  const tenantDoc = await adminDb
    .collection(Collections.tenants)
    .doc(tenantId)
    .get()

  if (!tenantDoc.exists) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  const subscription = (tenantDoc.data()?.subscription as TenantSubscription) ?? null

  // 2. Read current cycle rollup
  const now = new Date()
  const billingCycleId = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const rollupDoc = await adminDb
    .collection(Collections.usageRollups(tenantId))
    .doc(billingCycleId)
    .get()

  const rollup = rollupDoc.exists
    ? (rollupDoc.data() as UsageRollupDocument)
    : null

  // 3. Build daily usage from usage_logs (last 30 days)
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const logsSnapshot = await adminDb
    .collection(Collections.usageLogs(tenantId))
    .where('timestamp', '>=', thirtyDaysAgo.toISOString())
    .orderBy('timestamp', 'asc')
    .get()

  const dailyMap: Record<string, number> = {}
  for (const doc of logsSnapshot.docs) {
    const ts = doc.data().timestamp as string
    const day = ts.slice(0, 10) // YYYY-MM-DD
    dailyMap[day] = (dailyMap[day] ?? 0) + 1
  }

  const dailyUsage = Object.entries(dailyMap).map(([date, count]) => ({
    date,
    count,
  }))

  return NextResponse.json({
    subscription,
    rollup,
    dailyUsage,
    billingCycleId,
  })
}
