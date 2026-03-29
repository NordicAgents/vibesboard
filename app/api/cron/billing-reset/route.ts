import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'

export const runtime = 'nodejs'

/**
 * POST /api/cron/billing-reset
 * Reset billing cycle counters for free-plan tenants whose cycle has ended.
 * Protected by CRON_SECRET header.
 */
export async function POST(request: Request) {
  const cronSecret = request.headers.get('x-cron-secret')
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()

  // Query tenants on the free plan whose billing cycle has ended
  const tenantsSnap = await adminDb
    .collection(Collections.tenants)
    .where('subscription.planId', '==', 'free')
    .where('subscription.billingCycleEnd', '<=', now.toISOString())
    .get()

  if (tenantsSnap.empty) {
    return NextResponse.json({ reset: 0 })
  }

  // Compute new billing cycle boundaries (current month)
  const cycleStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    1
  ).toISOString()
  const cycleEnd = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    1
  ).toISOString()

  let resetCount = 0

  // Process in batches of 500 (Firestore batch limit)
  const docs = tenantsSnap.docs
  for (let i = 0; i < docs.length; i += 500) {
    const batch = adminDb.batch()
    const chunk = docs.slice(i, i + 500)

    for (const doc of chunk) {
      batch.update(doc.ref, {
        'subscription.messageCount': 0,
        'subscription.overageCount': 0,
        'subscription.billingCycleStart': cycleStart,
        'subscription.billingCycleEnd': cycleEnd,
        updatedAt: now.toISOString(),
      })
      resetCount++
    }

    await batch.commit()
  }

  console.log(
    `[billing-reset] Reset ${resetCount} free-plan tenants (${cycleStart} → ${cycleEnd})`
  )

  return NextResponse.json({ reset: resetCount })
}
