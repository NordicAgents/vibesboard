import { NextResponse } from 'next/server'
import { stripe } from '@vibesboard/adapter-stripe/server'
import { requireTenantAdmin } from '@/lib/firebase/route-handler'
import { adminDb } from '@vibesboard/adapter-firebase/admin'
import { Collections } from '@vibesboard/contracts'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const body = await request.json()
  const { tenantId, seatCount } = body as {
    tenantId: string
    seatCount: number
  }

  if (!tenantId || !seatCount) {
    return NextResponse.json(
      { error: 'tenantId and seatCount are required' },
      { status: 400 }
    )
  }

  // Auth check
  const auth = await requireTenantAdmin(tenantId)
  if (!auth.ok) return auth.response

  if (seatCount < 3) {
    return NextResponse.json(
      { error: 'Team plan requires at least 3 seats' },
      { status: 400 }
    )
  }

  // Get current subscription
  const tenantDoc = await adminDb
    .collection(Collections.tenants)
    .doc(tenantId)
    .get()

  const subscription = tenantDoc.data()?.subscription
  if (!subscription?.stripeSubscriptionId) {
    return NextResponse.json(
      { error: 'No active subscription found' },
      { status: 400 }
    )
  }

  if (subscription.planId !== 'team') {
    return NextResponse.json(
      { error: 'Seat management is only available for Team plans' },
      { status: 400 }
    )
  }

  // Retrieve the Stripe subscription to find the licensed item
  const stripeSub = await stripe.subscriptions.retrieve(
    subscription.stripeSubscriptionId
  )

  const baseItem = stripeSub.items.data.find(
    item => item.price.recurring?.usage_type !== 'metered'
  )

  if (!baseItem) {
    return NextResponse.json(
      { error: 'Could not find base subscription item' },
      { status: 500 }
    )
  }

  // Update seat count — Stripe webhook will handle the Firestore update
  await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
    items: [
      {
        id: baseItem.id,
        quantity: seatCount
      }
    ],
    proration_behavior: 'create_prorations'
  })

  return NextResponse.json({
    success: true,
    previousSeats: baseItem.quantity,
    newSeats: seatCount
  })
}
