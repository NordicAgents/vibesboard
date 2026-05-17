import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/firebase/route-handler'
import { adminDb } from '@vibesboard/adapter-firebase/admin'
import { Collections, type PlanTemplateDocument } from '@vibesboard/contracts'
import {
  invalidatePlanCache,
  computeMessageLimit,
  toPlanDefinition,
  type PlanId
} from '@vibesboard/policy/plans'
import { syncTenantFeatureFlags } from '@vibesboard/billing/plan-sync'
import { mapPlanToStripePrices } from '@vibesboard/billing/helpers'
import { rotatePlanPrices } from '@vibesboard/billing/price-migration'

export const runtime = 'nodejs'

type RouteParams = { params: Promise<{ id: string }> }

/**
 * GET /api/admin/plans/[id]
 * Get single plan template (SUPER_ADMIN only)
 */
export async function GET(req: Request, { params }: RouteParams) {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const snap = await adminDb.collection(Collections.planTemplates).doc(id).get()

  if (!snap.exists) {
    return NextResponse.json(
      { error: 'Plan template not found' },
      { status: 404 }
    )
  }

  return NextResponse.json({ plan: { id: snap.id, ...snap.data() } })
}

/**
 * PUT /api/admin/plans/[id]
 * Update plan template fields and propagate changes to existing tenants (SUPER_ADMIN only)
 */
export async function PUT(req: Request, { params }: RouteParams) {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const body = await req.json()

  const ref = adminDb.collection(Collections.planTemplates).doc(id)
  const snap = await ref.get()

  if (!snap.exists) {
    return NextResponse.json(
      { error: 'Plan template not found' },
      { status: 404 }
    )
  }

  const previousData = snap.data() as PlanTemplateDocument

  const updates: Record<string, unknown> = {
    updatedAt: new Date().toISOString()
  }

  if (body.name !== undefined) updates.name = body.name
  if (body.price !== undefined) updates.price = Number(body.price)
  if (body.pricePerSeat !== undefined)
    updates.pricePerSeat =
      body.pricePerSeat === null ? null : Number(body.pricePerSeat)
  if (body.minSeats !== undefined)
    updates.minSeats = body.minSeats === null ? null : Number(body.minSeats)
  if (body.includedMessages !== undefined)
    updates.includedMessages = Number(body.includedMessages)
  if (body.includedMessagesPerSeat !== undefined)
    updates.includedMessagesPerSeat =
      body.includedMessagesPerSeat === null
        ? null
        : Number(body.includedMessagesPerSeat)
  if (body.overageRate !== undefined)
    updates.overageRate = Number(body.overageRate)
  if (body.featureFlags !== undefined)
    updates.featureFlags = Array.isArray(body.featureFlags)
      ? body.featureFlags
      : []

  await ref.update(updates)

  // Invalidate plan template cache so live lookups see the change immediately
  invalidatePlanCache(id as PlanId)

  // ─── Propagation to existing tenants ──────────────────────────────
  const propagation: {
    featureFlagsSynced: boolean
    messageLimitsUpdated: boolean
    tenantsAffected: number
    errors: string[]
    priceRotated: boolean
    pendingMigration: {
      oldBasePriceId: string
      newBasePriceId: string
      subscribersToMigrate: number
    } | null
  } = {
    featureFlagsSynced: false,
    messageLimitsUpdated: false,
    tenantsAffected: 0,
    errors: [],
    priceRotated: false,
    pendingMigration: null
  }

  // Detect what changed
  const oldFlags = new Set(previousData.featureFlags ?? [])
  const newFlags =
    updates.featureFlags !== undefined
      ? new Set(updates.featureFlags as string[])
      : null
  const flagsChanged =
    newFlags !== null &&
    (oldFlags.size !== newFlags.size ||
      [...oldFlags].some(f => !newFlags.has(f)))

  const limitChanged =
    (updates.includedMessages !== undefined &&
      updates.includedMessages !== previousData.includedMessages) ||
    (updates.includedMessagesPerSeat !== undefined &&
      updates.includedMessagesPerSeat !== previousData.includedMessagesPerSeat)

  // Only query tenants if something needs propagating
  if (flagsChanged || limitChanged) {
    const tenantsSnap = await adminDb
      .collection(Collections.tenants)
      .where('subscription.planId', '==', id)
      .get()

    if (!tenantsSnap.empty) {
      // Propagate feature flags
      if (flagsChanged) {
        const flagArray = updates.featureFlags as string[]
        for (let i = 0; i < tenantsSnap.docs.length; i += 25) {
          const chunk = tenantsSnap.docs.slice(i, i + 25)
          const results = await Promise.allSettled(
            chunk.map((doc: FirebaseFirestore.QueryDocumentSnapshot) =>
              syncTenantFeatureFlags(doc.id, flagArray)
            )
          )
          for (const r of results) {
            if (r.status === 'fulfilled') {
              propagation.tenantsAffected++
            } else {
              propagation.errors.push(r.reason?.message ?? 'Unknown error')
            }
          }
        }
        propagation.featureFlagsSynced = true
      }

      // Propagate message limit snapshot
      if (limitChanged) {
        const updatedSnap = await ref.get()
        const newPlan = toPlanDefinition(
          updatedSnap.data() as PlanTemplateDocument
        )
        const docs = tenantsSnap.docs
        let limitsUpdated = 0

        for (let i = 0; i < docs.length; i += 500) {
          const batch = adminDb.batch()
          const chunk = docs.slice(i, i + 500)
          for (const doc of chunk) {
            const sub = doc.data().subscription
            // Skip tenants with custom message limit override
            if (sub?.customMessageLimit != null) continue
            const seatCount = sub?.seatCount ?? 1
            const newLimit = computeMessageLimit(newPlan, seatCount)
            batch.update(doc.ref, {
              'subscription.messageLimit': newLimit,
              updatedAt: new Date().toISOString()
            })
            limitsUpdated++
          }
          await batch.commit()
        }
        propagation.messageLimitsUpdated = true
        // If flags weren't changed, tenantsAffected reflects limit updates
        if (!flagsChanged) {
          propagation.tenantsAffected = limitsUpdated
        }
      }
    }
  }

  // ─── Stripe price rotation ──────────────────────────────────────────
  const priceChanged =
    (updates.price !== undefined && updates.price !== previousData.price) ||
    (updates.pricePerSeat !== undefined &&
      updates.pricePerSeat !== previousData.pricePerSeat)

  if (priceChanged) {
    try {
      const currentPrices = await mapPlanToStripePrices(id as PlanId)
      if (currentPrices?.basePriceId) {
        // Use pricePerSeat for per-seat plans (e.g. Team), otherwise use price
        const prevPerSeat = previousData.pricePerSeat as number | undefined
        const newBaseAmount =
          prevPerSeat != null
            ? ((updates.pricePerSeat ?? prevPerSeat) as number)
            : ((updates.price ?? previousData.price) as number)

        // overageRate is in fractional cents (e.g. 0.5 = $0.005) — pass as string for unit_amount_decimal
        const newOverageAmountDecimal = String(
          (updates.overageRate ?? previousData.overageRate) as number
        )

        const rotateResult = await rotatePlanPrices(
          id as PlanId,
          newBaseAmount,
          newOverageAmountDecimal,
          currentPrices
        )

        // Count subscribers to migrate
        const subSnap = await adminDb
          .collection(Collections.tenants)
          .where('subscription.planId', '==', id)
          .where('subscription.stripeSubscriptionId', '!=', null)
          .get()

        propagation.priceRotated = true
        propagation.pendingMigration = {
          oldBasePriceId: rotateResult.oldBasePriceId,
          newBasePriceId: rotateResult.newBasePriceId,
          subscribersToMigrate: subSnap.size
        }
      }
    } catch (err) {
      console.error('[admin/plans] Failed to rotate Stripe prices:', err)
      propagation.errors.push(
        `Stripe price rotation failed: ${err instanceof Error ? err.message : 'Unknown error'}`
      )
    }
  }

  const updated = await ref.get()
  return NextResponse.json({
    plan: { id: updated.id, ...updated.data() },
    propagation
  })
}
