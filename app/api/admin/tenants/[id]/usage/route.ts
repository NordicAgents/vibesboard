import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/firebase/route-handler'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import type { TenantSubscription, UsageRollupDocument } from '@/lib/firestore-types'

export const runtime = 'nodejs'

type RouteParams = {
  params: Promise<{ id: string }>
}

/**
 * GET /api/admin/tenants/[id]/usage
 * Returns usage data for any tenant (SUPER_ADMIN only).
 * Includes agent name resolution.
 */
export async function GET(req: Request, { params }: RouteParams) {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response

  const { id: tenantId } = await params

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

  // 3. Resolve agent IDs → names
  const agentNames: Record<string, string> = {}
  if (rollup?.byAgent) {
    const agentIds = Object.keys(rollup.byAgent)
    if (agentIds.length > 0) {
      const agentDocs = await Promise.all(
        agentIds.map(id =>
          adminDb.collection(Collections.agents(tenantId)).doc(id).get()
        )
      )
      for (const doc of agentDocs) {
        if (doc.exists) {
          agentNames[doc.id] = (doc.data()?.name as string) ?? doc.id
        }
      }
    }
  }

  // 4. Resolve user IDs → names/emails
  const userNames: Record<string, string> = {}
  if (rollup?.byUser) {
    const allUserKeys = Object.keys(rollup.byUser)
    // Separate authenticated users from external (anonymous) identifiers
    const authUserIds = allUserKeys.filter(id => !id.startsWith('ext:') && id !== '_anonymous')
    const extUserIds = allUserKeys.filter(id => id.startsWith('ext:'))

    // Resolve authenticated user IDs from Firestore
    if (authUserIds.length > 0) {
      const userDocs = await Promise.all(
        authUserIds.map(id =>
          adminDb.collection(Collections.users).doc(id).get()
        )
      )
      for (const doc of userDocs) {
        if (doc.exists) {
          const data = doc.data()
          userNames[doc.id] = (data?.name as string) || (data?.email as string) || doc.id
        }
      }
    }

    // Label external identifiers (session IDs, hook IDs, external user IDs)
    for (const extKey of extUserIds) {
      const rawId = extKey.slice(4) // strip "ext:" prefix
      userNames[extKey] = rawId
    }
  }

  // 5. Build daily usage from usage_logs (last 30 days)
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
    const day = ts.slice(0, 10)
    dailyMap[day] = (dailyMap[day] ?? 0) + 1
  }

  const dailyUsage = Object.entries(dailyMap).map(([date, count]) => ({
    date,
    count,
  }))

  return NextResponse.json({
    subscription,
    rollup,
    agentNames,
    userNames,
    dailyUsage,
    billingCycleId,
  })
}
