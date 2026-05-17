import 'server-only'
import { stripe } from '@vibesboard/adapter-stripe/server'
import { adminDb } from '@vibesboard/adapter-firebase/admin'
import { Collections } from '@vibesboard/contracts'
import type { PlanId } from '@vibesboard/policy/plans'

// ─── Price ID mapping ────────────────────────────────────────────────

export interface StripePrices {
  basePriceId: string
  overagePriceId: string
}

/** Lazily read env vars at runtime, not at module load */
function getPriceMap(): Record<string, StripePrices> {
  return {
    pro: {
      basePriceId: process.env.STRIPE_PRICE_PRO_BASE ?? '',
      overagePriceId: process.env.STRIPE_PRICE_PRO_OVERAGE ?? ''
    },
    team: {
      basePriceId: process.env.STRIPE_PRICE_TEAM_BASE ?? '',
      overagePriceId: process.env.STRIPE_PRICE_TEAM_OVERAGE ?? ''
    }
  }
}

/**
 * Get the Stripe Price IDs for a given plan.
 * Checks Firestore plan template first, falls back to env vars.
 * Returns null for free/enterprise (no Stripe objects).
 */
export async function mapPlanToStripePrices(
  planId: PlanId
): Promise<StripePrices | null> {
  try {
    const snap = await adminDb
      .collection(Collections.planTemplates)
      .doc(planId)
      .get()
    if (snap.exists) {
      const data = snap.data()
      if (data?.stripeBasePriceId && data?.stripeOveragePriceId) {
        return {
          basePriceId: data.stripeBasePriceId,
          overagePriceId: data.stripeOveragePriceId
        }
      }
    }
  } catch (err) {
    console.error('[stripe-helpers] Failed to read plan template:', err)
  }
  // Fallback to env vars
  return getPriceMap()[planId] ?? null
}

/**
 * Reverse-lookup: find the PlanId from a Stripe base price ID.
 * Checks Firestore plan templates first, falls back to env vars.
 */
export async function mapStripePriceToPlan(
  priceId: string
): Promise<PlanId | null> {
  try {
    const snap = await adminDb
      .collection(Collections.planTemplates)
      .where('stripeBasePriceId', '==', priceId)
      .limit(1)
      .get()
    if (!snap.empty) return snap.docs[0].id as PlanId
  } catch (err) {
    console.error('[stripe-helpers] Failed to query plan templates:', err)
  }
  // Fallback to env vars
  for (const [planId, prices] of Object.entries(getPriceMap())) {
    if (prices.basePriceId === priceId) {
      return planId as PlanId
    }
  }
  return null
}

// ─── Customer management ─────────────────────────────────────────────

/**
 * Get or create a Stripe Customer for a tenant.
 * Idempotent — checks Firestore first, creates in Stripe if needed.
 */
export async function getOrCreateStripeCustomer(
  tenantId: string,
  email: string,
  tenantName: string
): Promise<string> {
  const tenantRef = adminDb.collection(Collections.tenants).doc(tenantId)
  const tenantDoc = await tenantRef.get()

  if (!tenantDoc.exists) {
    throw new Error(`Tenant ${tenantId} not found`)
  }

  const existing = tenantDoc.data()?.subscription?.stripeCustomerId
  if (existing) {
    return existing
  }

  // Create in Stripe
  const customer = await stripe.customers.create({
    email,
    name: tenantName,
    metadata: { tenantId }
  })

  // Write back to Firestore
  await tenantRef.update({
    'subscription.stripeCustomerId': customer.id,
    updatedAt: new Date().toISOString()
  })

  return customer.id
}

/**
 * Find the tenant ID associated with a Stripe Customer ID.
 */
export async function findTenantByStripeCustomer(
  stripeCustomerId: string
): Promise<string | null> {
  const snap = await adminDb
    .collection(Collections.tenants)
    .where('subscription.stripeCustomerId', '==', stripeCustomerId)
    .limit(1)
    .get()

  if (snap.empty) return null
  return snap.docs[0].id
}
