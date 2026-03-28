import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/firebase/route-handler'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { getPlanTemplate, computeMessageLimit, type PlanId } from '@/lib/plans'
import { syncTenantFeatureFlags } from '@/lib/plan-sync'

export const runtime = 'nodejs'

type RouteParams = { params: Promise<{ id: string }> }

/** Returns YYYY-MM for the current month */
function getCurrentBillingCycleId(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

/**
 * GET /api/admin/tenants/[id]/subscription
 * Returns tenant subscription + plan details + current usage rollup
 */
export async function GET(req: Request, { params }: RouteParams) {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response

  const { id: tenantId } = await params

  const tenantDoc = await adminDb.collection(Collections.tenants).doc(tenantId).get()
  if (!tenantDoc.exists) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  const tenant = tenantDoc.data()
  const subscription = tenant?.subscription ?? null

  // Fetch plan template
  let planTemplate = null
  if (subscription?.planId) {
    planTemplate = await getPlanTemplate(subscription.planId as PlanId)
  }

  // Fetch current usage rollup
  const cycleId = getCurrentBillingCycleId()
  const rollupDoc = await adminDb
    .collection(Collections.usageRollups(tenantId))
    .doc(cycleId)
    .get()
  const rollup = rollupDoc.exists ? rollupDoc.data() : null

  return NextResponse.json({
    subscription,
    planTemplate,
    rollup,
    billingCycleId: cycleId,
  })
}

/**
 * PUT /api/admin/tenants/[id]/subscription
 * Update tenant subscription — change plan, override limits, reset usage
 */
export async function PUT(req: Request, { params }: RouteParams) {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response

  const { id: tenantId } = await params
  const body = await req.json()

  const tenantRef = adminDb.collection(Collections.tenants).doc(tenantId)
  const tenantDoc = await tenantRef.get()
  if (!tenantDoc.exists) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  const tenant = tenantDoc.data()!
  const currentSub = tenant.subscription ?? {}

  const updates: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  }

  // Resolve the target plan
  const newPlanId = (body.planId ?? currentSub.planId ?? 'free') as PlanId
  const newSeatCount = body.seatCount ?? currentSub.seatCount ?? 1
  const plan = await getPlanTemplate(newPlanId)

  // Compute effective message limit
  let messageLimit: number
  if (body.customMessageLimit !== undefined && body.customMessageLimit !== null) {
    // Admin is setting a custom override
    messageLimit = Number(body.customMessageLimit)
    updates['subscription.customMessageLimit'] = messageLimit
  } else if (body.customMessageLimit === null) {
    // Admin is clearing the override
    messageLimit = computeMessageLimit(plan, newSeatCount)
    updates['subscription.customMessageLimit'] = null
  } else if (currentSub.customMessageLimit != null) {
    // Keep existing custom override
    messageLimit = currentSub.customMessageLimit
  } else {
    // Use plan default
    messageLimit = computeMessageLimit(plan, newSeatCount)
  }

  // Handle custom overage rate
  if (body.customOverageRate !== undefined) {
    updates['subscription.customOverageRate'] = body.customOverageRate === null
      ? null
      : Number(body.customOverageRate)
  }

  // Core subscription fields
  updates['subscription.planId'] = newPlanId
  updates['subscription.seatCount'] = newSeatCount
  updates['subscription.messageLimit'] = messageLimit

  // Billing cycle dates
  if (body.billingCycleStart) updates['subscription.billingCycleStart'] = body.billingCycleStart
  if (body.billingCycleEnd) updates['subscription.billingCycleEnd'] = body.billingCycleEnd

  // Initialize missing fields
  if (currentSub.messageCount === undefined) updates['subscription.messageCount'] = 0
  if (currentSub.overageCount === undefined) updates['subscription.overageCount'] = 0
  if (currentSub.stripeCustomerId === undefined) updates['subscription.stripeCustomerId'] = null
  if (currentSub.stripeSubscriptionId === undefined) updates['subscription.stripeSubscriptionId'] = null
  if (currentSub.stripePriceId === undefined) updates['subscription.stripePriceId'] = null
  if (currentSub.trialEndsAt === undefined) updates['subscription.trialEndsAt'] = null

  // Reset usage if requested
  if (body.resetUsage) {
    updates['subscription.messageCount'] = 0
    updates['subscription.overageCount'] = 0
  }

  await tenantRef.update(updates)

  // Sync feature flags when plan changes
  const planChanged = newPlanId !== currentSub.planId
  if (planChanged) {
    try {
      await syncTenantFeatureFlags(tenantId, plan.featureFlags)
    } catch (err: unknown) {
      console.error('[subscription] Failed to sync feature flags:', err)
      // Non-fatal — subscription was still updated
    }
  }

  // Return updated subscription
  const updatedDoc = await tenantRef.get()
  const updatedSub = updatedDoc.data()?.subscription ?? null

  return NextResponse.json({
    subscription: updatedSub,
    featureFlagsSynced: planChanged,
  })
}
