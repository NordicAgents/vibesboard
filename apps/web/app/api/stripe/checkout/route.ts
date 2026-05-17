import { NextResponse } from 'next/server'
import { stripe } from '@vibesboard/adapter-stripe/server'
import { requireTenantAdmin } from '@/lib/firebase/route-handler'
import { adminDb } from '@vibesboard/adapter-firebase/admin'
import { Collections } from '@vibesboard/contracts'
import {
  getOrCreateStripeCustomer,
  mapPlanToStripePrices
} from '@vibesboard/billing/helpers'
import type { PlanId } from '@vibesboard/policy/plans'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const body = await request.json()
  const { tenantId, planId, seatCount } = body as {
    tenantId: string
    planId: 'pro' | 'team'
    seatCount?: number
  }

  if (!tenantId || !planId) {
    return NextResponse.json(
      { error: 'tenantId and planId are required' },
      { status: 400 }
    )
  }

  if (planId !== 'pro' && planId !== 'team') {
    return NextResponse.json(
      { error: 'planId must be "pro" or "team"' },
      { status: 400 }
    )
  }

  if (planId === 'team' && (!seatCount || seatCount < 3)) {
    return NextResponse.json(
      { error: 'Team plan requires at least 3 seats' },
      { status: 400 }
    )
  }

  // Auth check
  const auth = await requireTenantAdmin(tenantId)
  if (!auth.ok) return auth.response

  // Get tenant info
  const tenantDoc = await adminDb
    .collection(Collections.tenants)
    .doc(tenantId)
    .get()
  if (!tenantDoc.exists) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  const tenant = tenantDoc.data()!

  // Check if already subscribed via Stripe
  if (tenant.subscription?.stripeSubscriptionId) {
    return NextResponse.json(
      {
        error:
          'Tenant already has an active Stripe subscription. Use the customer portal to manage it.'
      },
      { status: 409 }
    )
  }

  // Get or create Stripe customer
  const stripeCustomerId = await getOrCreateStripeCustomer(
    tenantId,
    auth.user.email ?? '',
    tenant.name
  )

  // Get price IDs for the plan
  const prices = await mapPlanToStripePrices(planId as PlanId)
  if (!prices) {
    return NextResponse.json(
      { error: 'No Stripe prices configured for this plan' },
      { status: 500 }
    )
  }

  // Build line items
  const lineItems: Array<{ price: string; quantity?: number }> = [
    {
      price: prices.basePriceId,
      quantity: planId === 'team' ? (seatCount ?? 3) : 1
    },
    {
      price: prices.overagePriceId
      // No quantity for metered prices
    }
  ]

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  // Create Checkout Session
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: stripeCustomerId,
    line_items: lineItems,
    subscription_data: {
      metadata: { tenantId, planId }
    },
    success_url: `${appUrl}/settings/tenant/billing?success=true`,
    cancel_url: `${appUrl}/settings/tenant/billing?canceled=true`,
    metadata: { tenantId, planId }
  })

  return NextResponse.json({ url: session.url })
}
