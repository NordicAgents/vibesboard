import 'server-only'
import type Stripe from 'stripe'
import { stripe } from './stripe'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import {
  mapStripePriceToPlan,
  findTenantByStripeCustomer
} from './stripe-helpers'
import {
  getPlanTemplate,
  computeMessageLimit,
  DEFAULT_PLANS,
  type PlanId
} from './plans'
import { syncTenantFeatureFlags } from './plan-sync'

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Resolve the tenantId from a Stripe subscription or invoice.
 * Checks metadata first, falls back to customer-based lookup.
 */
async function resolveTenantId(
  metadata: Stripe.Metadata | null | undefined,
  customerId: string | Stripe.Customer | Stripe.DeletedCustomer | null
): Promise<string | null> {
  if (metadata?.tenantId) return metadata.tenantId

  const custId =
    typeof customerId === 'string' ? customerId : (customerId?.id ?? null)
  if (!custId) return null

  return findTenantByStripeCustomer(custId)
}

/**
 * Extract the subscription ID from an invoice's parent field (Stripe v21+).
 */
function getSubscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  if (invoice.parent?.type === 'subscription_details') {
    const sub = invoice.parent.subscription_details?.subscription
    if (typeof sub === 'string') return sub
    if (sub?.id) return sub.id
  }
  return null
}

/**
 * Find the metered (overage) subscription item from a Stripe subscription.
 */
function findOverageItem(
  subscription: Stripe.Subscription
): Stripe.SubscriptionItem | null {
  return (
    subscription.items.data.find(
      item => item.price.recurring?.usage_type === 'metered'
    ) ?? null
  )
}

/**
 * Find the licensed (base) subscription item from a Stripe subscription.
 */
function findBaseItem(
  subscription: Stripe.Subscription
): Stripe.SubscriptionItem | null {
  return (
    subscription.items.data.find(
      item => item.price.recurring?.usage_type !== 'metered'
    ) ?? null
  )
}

// ─── Event handlers ──────────────────────────────────────────────────

/**
 * Handle customer.subscription.created and customer.subscription.updated.
 * State-setting (not incremental) for idempotency.
 */
export async function handleSubscriptionChange(
  subscription: Stripe.Subscription
): Promise<void> {
  const tenantId = await resolveTenantId(
    subscription.metadata,
    subscription.customer
  )
  if (!tenantId) {
    console.error(
      '[stripe] Could not resolve tenantId for subscription:',
      subscription.id
    )
    return
  }

  const baseItem = findBaseItem(subscription)
  const overageItem = findOverageItem(subscription)
  const basePriceId = baseItem?.price.id ?? null

  // Determine plan from price
  const planId: PlanId = basePriceId
    ? ((await mapStripePriceToPlan(basePriceId)) ?? 'pro')
    : 'pro'

  const plan = await getPlanTemplate(planId)
  const seatCount = baseItem?.quantity ?? 1
  const messageLimit = computeMessageLimit(plan, seatCount)

  // Billing cycle dates — fetch latest invoice period or fallback to start_date
  let cycleStart: string
  let cycleEnd: string

  const latestInvoiceId =
    typeof subscription.latest_invoice === 'string'
      ? subscription.latest_invoice
      : (subscription.latest_invoice?.id ?? null)

  if (latestInvoiceId) {
    try {
      const inv =
        typeof subscription.latest_invoice === 'string'
          ? await stripe.invoices.retrieve(latestInvoiceId)
          : subscription.latest_invoice!
      cycleStart = new Date(inv.period_start * 1000).toISOString()
      cycleEnd = new Date(inv.period_end * 1000).toISOString()
    } catch {
      // Fallback if invoice retrieval fails
      const start = new Date(subscription.start_date * 1000)
      cycleStart = start.toISOString()
      cycleEnd = new Date(
        start.getFullYear(),
        start.getMonth() + 1,
        start.getDate()
      ).toISOString()
    }
  } else {
    // Fallback: use subscription start_date and compute monthly end
    const start = new Date(subscription.start_date * 1000)
    cycleStart = start.toISOString()
    cycleEnd = new Date(
      start.getFullYear(),
      start.getMonth() + 1,
      start.getDate()
    ).toISOString()
  }

  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer.id

  const tenantRef = adminDb.collection(Collections.tenants).doc(tenantId)
  await tenantRef.update({
    status: 'active',
    'subscription.planId': planId,
    'subscription.seatCount': seatCount,
    'subscription.messageLimit': messageLimit,
    'subscription.stripeCustomerId': customerId,
    'subscription.stripeSubscriptionId': subscription.id,
    'subscription.stripePriceId': basePriceId,
    'subscription.stripeOverageItemId': overageItem?.id ?? null,
    'subscription.billingCycleStart': cycleStart,
    'subscription.billingCycleEnd': cycleEnd,
    updatedAt: new Date().toISOString()
  })

  // Sync feature flags to match the new plan
  try {
    await syncTenantFeatureFlags(tenantId, plan.featureFlags)
  } catch (err) {
    console.error(
      '[stripe] Failed to sync feature flags for tenant:',
      tenantId,
      err
    )
  }

  console.log(
    `[stripe] Subscription ${subscription.id} → tenant ${tenantId} updated to ${planId} (${seatCount} seats)`
  )
}

/**
 * Handle customer.subscription.deleted — downgrade to Free.
 */
export async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription
): Promise<void> {
  const tenantId = await resolveTenantId(
    subscription.metadata,
    subscription.customer
  )
  if (!tenantId) {
    console.error(
      '[stripe] Could not resolve tenantId for deleted subscription:',
      subscription.id
    )
    return
  }

  const freePlan = DEFAULT_PLANS.free
  const now = new Date()
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

  const tenantRef = adminDb.collection(Collections.tenants).doc(tenantId)
  await tenantRef.update({
    'subscription.planId': 'free',
    'subscription.seatCount': 1,
    'subscription.messageLimit': freePlan.includedMessages,
    'subscription.stripeSubscriptionId': null,
    'subscription.stripePriceId': null,
    'subscription.stripeOverageItemId': null,
    'subscription.billingCycleStart': cycleStart,
    'subscription.billingCycleEnd': cycleEnd,
    'subscription.messageCount': 0,
    'subscription.overageCount': 0,
    updatedAt: now.toISOString()
  })

  // Sync feature flags to free plan
  try {
    await syncTenantFeatureFlags(tenantId, freePlan.featureFlags)
  } catch (err) {
    console.error(
      '[stripe] Failed to sync feature flags on downgrade:',
      tenantId,
      err
    )
  }

  console.log(
    `[stripe] Subscription ${subscription.id} deleted → tenant ${tenantId} downgraded to Free`
  )
}

/**
 * Handle invoice.created — report overage usage before invoice finalization.
 * In Stripe v21+, we add overage as a one-off invoice item.
 */
export async function handleInvoiceCreated(
  invoice: Stripe.Invoice
): Promise<void> {
  // Only process subscription renewal invoices
  if (
    invoice.billing_reason !== 'subscription_cycle' &&
    invoice.billing_reason !== 'subscription_update'
  ) {
    return
  }

  const subscriptionId = getSubscriptionIdFromInvoice(invoice)
  if (!subscriptionId) return

  const subscription = await stripe.subscriptions.retrieve(subscriptionId)
  const tenantId = await resolveTenantId(
    subscription.metadata,
    subscription.customer
  )
  if (!tenantId) return

  // Read current usage
  const tenantDoc = await adminDb
    .collection(Collections.tenants)
    .doc(tenantId)
    .get()
  const sub = tenantDoc.data()?.subscription
  if (!sub) return

  const messageCount = (sub.messageCount as number) ?? 0
  const messageLimit = (sub.messageLimit as number) ?? 0
  const overageCount = Math.max(0, messageCount - messageLimit)

  if (overageCount > 0) {
    // Determine overage rate from plan
    const plan = await getPlanTemplate(sub.planId as PlanId)
    const effectiveOverageRate = sub.customOverageRate ?? plan.overageRate
    // overageRate is in cents (e.g., 0.5 = $0.005/msg). Compute total in cents and round once.
    const totalAmount = Math.round(effectiveOverageRate * overageCount)

    const customerId =
      typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer.id

    // Add overage as an invoice item on the current invoice
    await stripe.invoiceItems.create({
      customer: customerId,
      invoice: invoice.id,
      amount: totalAmount,
      currency: 'usd',
      description: `Message overage: ${overageCount} messages × $${(effectiveOverageRate / 100).toFixed(4)}/msg`
    })

    console.log(
      `[stripe] Reported ${overageCount} overage messages for tenant ${tenantId} (${effectiveOverageRate}¢/msg × ${overageCount} = ${totalAmount}¢)`
    )
  }
}

/**
 * Handle invoice.payment_succeeded — reset billing cycle counters.
 */
export async function handlePaymentSucceeded(
  invoice: Stripe.Invoice
): Promise<void> {
  // Only reset on subscription cycle renewals
  if (invoice.billing_reason !== 'subscription_cycle') return

  const subscriptionId = getSubscriptionIdFromInvoice(invoice)
  if (!subscriptionId) return

  const subscription = await stripe.subscriptions.retrieve(subscriptionId)
  const tenantId = await resolveTenantId(
    subscription.metadata,
    subscription.customer
  )
  if (!tenantId) return

  // Use the invoice period as the new billing cycle
  const cycleStart = new Date(invoice.period_start * 1000).toISOString()
  const cycleEnd = new Date(invoice.period_end * 1000).toISOString()

  const tenantRef = adminDb.collection(Collections.tenants).doc(tenantId)
  await tenantRef.update({
    'subscription.messageCount': 0,
    'subscription.overageCount': 0,
    'subscription.billingCycleStart': cycleStart,
    'subscription.billingCycleEnd': cycleEnd,
    updatedAt: new Date().toISOString()
  })

  console.log(
    `[stripe] Billing cycle reset for tenant ${tenantId} (${cycleStart} → ${cycleEnd})`
  )
}

/**
 * Handle invoice.payment_failed — suspend after multiple failures.
 */
export async function handlePaymentFailed(
  invoice: Stripe.Invoice
): Promise<void> {
  const subscriptionId = getSubscriptionIdFromInvoice(invoice)
  if (!subscriptionId) return

  const subscription = await stripe.subscriptions.retrieve(subscriptionId)
  const tenantId = await resolveTenantId(
    subscription.metadata,
    subscription.customer
  )
  if (!tenantId) return

  const attemptCount = invoice.attempt_count ?? 0

  if (attemptCount >= 3) {
    // Suspend the tenant after 3 failed attempts
    const tenantRef = adminDb.collection(Collections.tenants).doc(tenantId)
    await tenantRef.update({
      status: 'suspended',
      updatedAt: new Date().toISOString()
    })

    console.log(
      `[stripe] Tenant ${tenantId} suspended after ${attemptCount} failed payment attempts`
    )
  } else {
    console.warn(
      `[stripe] Payment failed for tenant ${tenantId} (attempt ${attemptCount})`
    )
  }
}
