import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/firebase/route-handler'
import { adminDb } from '@vibesboard/adapter-firebase/admin'
import { Collections } from '@vibesboard/contracts'
import { migrateSubscriptionPrices } from '@vibesboard/billing/price-migration'
import type { PlanId } from '@vibesboard/policy/plans'

export const runtime = 'nodejs'

type RouteParams = { params: Promise<{ id: string }> }

/**
 * POST /api/admin/plans/[id]/migrate-prices
 * Migrate all existing subscribers to the new Stripe prices (SUPER_ADMIN only).
 */
export async function POST(req: Request, { params }: RouteParams) {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params

  // Verify plan exists and has a pending migration
  const snap = await adminDb.collection(Collections.planTemplates).doc(id).get()

  if (!snap.exists) {
    return NextResponse.json(
      { error: 'Plan template not found' },
      { status: 404 }
    )
  }

  const planData = snap.data()!
  if (!planData.pendingPriceMigration) {
    return NextResponse.json(
      { error: 'No pending price migration for this plan' },
      { status: 404 }
    )
  }

  try {
    const result = await migrateSubscriptionPrices(id as PlanId)
    return NextResponse.json({
      success: true,
      migrated: result.migrated,
      errors: result.errors
    })
  } catch (err) {
    console.error('[admin/plans] Price migration failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Migration failed' },
      { status: 500 }
    )
  }
}
