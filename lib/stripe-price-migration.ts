import 'server-only'
import { stripe } from './stripe'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import type { PlanId } from './plans'

export interface RotateResult {
  newBasePriceId: string
  newOveragePriceId: string
  oldBasePriceId: string
  oldOveragePriceId: string
}

/**
 * Create new Stripe Prices for a plan and archive old ones.
 * Writes new price IDs + pendingPriceMigration to the plan template.
 */
export async function rotatePlanPrices(
  planId: PlanId,
  newBaseAmount: number,
  newOverageAmountDecimal: string,
  currentPrices: { basePriceId: string; overagePriceId: string }
): Promise<RotateResult> {
  // Retrieve old prices to get product ID and recurring config
  const oldBasePrice = await stripe.prices.retrieve(currentPrices.basePriceId)
  const oldOveragePrice = await stripe.prices.retrieve(currentPrices.overagePriceId)

  const productId =
    typeof oldBasePrice.product === 'string'
      ? oldBasePrice.product
      : oldBasePrice.product.id

  // Create new base price on same product
  const newBasePrice = await stripe.prices.create({
    product: productId,
    unit_amount: newBaseAmount,
    currency: oldBasePrice.currency,
    recurring: {
      interval: oldBasePrice.recurring!.interval,
    },
    metadata: { planId, type: 'base' },
  })

  // Create new overage price on same product with same meter
  const overageProductId =
    typeof oldOveragePrice.product === 'string'
      ? oldOveragePrice.product
      : oldOveragePrice.product.id

  const newOveragePrice = await stripe.prices.create({
    product: overageProductId,
    unit_amount_decimal: newOverageAmountDecimal,
    currency: oldOveragePrice.currency,
    recurring: {
      interval: oldOveragePrice.recurring!.interval,
      usage_type: 'metered',
      meter: oldOveragePrice.recurring!.meter ?? undefined,
    },
    billing_scheme: 'per_unit',
    metadata: { planId, type: 'overage' },
  })

  // Archive old prices
  await Promise.all([
    stripe.prices.update(currentPrices.basePriceId, { active: false }),
    stripe.prices.update(currentPrices.overagePriceId, { active: false }),
  ])

  // Update plan template with new price IDs and pending migration
  const planRef = adminDb.collection(Collections.planTemplates).doc(planId)
  await planRef.update({
    stripeBasePriceId: newBasePrice.id,
    stripeOveragePriceId: newOveragePrice.id,
    pendingPriceMigration: {
      oldBasePriceId: currentPrices.basePriceId,
      oldOveragePriceId: currentPrices.overagePriceId,
      newBasePriceId: newBasePrice.id,
      newOveragePriceId: newOveragePrice.id,
      createdAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  })

  return {
    newBasePriceId: newBasePrice.id,
    newOveragePriceId: newOveragePrice.id,
    oldBasePriceId: currentPrices.basePriceId,
    oldOveragePriceId: currentPrices.overagePriceId,
  }
}

/**
 * Migrate all active subscriptions on a plan to new prices.
 * Uses stripe.subscriptions.update() with proration_behavior: 'create_prorations'.
 * Clears pendingPriceMigration on completion.
 */
export async function migrateSubscriptionPrices(
  planId: PlanId
): Promise<{ migrated: number; errors: string[] }> {
  const planRef = adminDb.collection(Collections.planTemplates).doc(planId)
  const planSnap = await planRef.get()

  if (!planSnap.exists) {
    throw new Error(`Plan template ${planId} not found`)
  }

  const planData = planSnap.data()!
  const migration = planData.pendingPriceMigration
  if (!migration) {
    throw new Error(`No pending price migration for plan ${planId}`)
  }

  // Query all tenants on this plan with active Stripe subscriptions
  const tenantsSnap = await adminDb
    .collection(Collections.tenants)
    .where('subscription.planId', '==', planId)
    .get()

  const subscribedTenants = tenantsSnap.docs.filter(
    (doc: FirebaseFirestore.QueryDocumentSnapshot) =>
      doc.data().subscription?.stripeSubscriptionId
  )

  let migrated = 0
  const errors: string[] = []

  // Process in chunks of 10 (Stripe rate limits)
  for (let i = 0; i < subscribedTenants.length; i += 10) {
    const chunk = subscribedTenants.slice(i, i + 10)
    const results = await Promise.allSettled(
      chunk.map(async (doc: FirebaseFirestore.QueryDocumentSnapshot) => {
        const sub = doc.data().subscription
        const subId = sub.stripeSubscriptionId as string

        // Retrieve the Stripe subscription to find item IDs
        const stripeSub = await stripe.subscriptions.retrieve(subId)

        const baseItem = stripeSub.items.data.find(
          (item) => item.price.recurring?.usage_type !== 'metered'
        )
        const overageItem = stripeSub.items.data.find(
          (item) => item.price.recurring?.usage_type === 'metered'
        )

        if (!baseItem) {
          throw new Error(`No base item found on subscription ${subId}`)
        }

        // Build items array for update
        const items: Array<{ id: string; price: string; quantity?: number }> = [
          {
            id: baseItem.id,
            price: migration.newBasePriceId,
            quantity: baseItem.quantity ?? 1,
          },
        ]

        if (overageItem) {
          items.push({
            id: overageItem.id,
            price: migration.newOveragePriceId,
          })
        }

        await stripe.subscriptions.update(subId, {
          items,
          proration_behavior: 'create_prorations',
        })
      })
    )

    for (const r of results) {
      if (r.status === 'fulfilled') {
        migrated++
      } else {
        errors.push(r.reason?.message ?? 'Unknown error')
      }
    }
  }

  // Clear pendingPriceMigration
  await planRef.update({
    pendingPriceMigration: null,
    updatedAt: new Date().toISOString(),
  })

  console.log(
    `[stripe] Price migration for ${planId}: ${migrated} migrated, ${errors.length} errors`
  )

  return { migrated, errors }
}
