import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/firebase/route-handler'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { stripe } from '@/lib/stripe'
import { handleSubscriptionChange } from '@/lib/stripe-webhook-handlers'

export const runtime = 'nodejs'

type RouteParams = { params: Promise<{ id: string }> }

/**
 * POST /api/admin/tenants/[id]/stripe-sync
 * Force-sync tenant subscription state from Stripe.
 */
export async function POST(req: Request, { params }: RouteParams) {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response

  const { id: tenantId } = await params

  const tenantDoc = await adminDb
    .collection(Collections.tenants)
    .doc(tenantId)
    .get()
  if (!tenantDoc.exists) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  const subscriptionId = tenantDoc.data()?.subscription?.stripeSubscriptionId
  if (!subscriptionId) {
    return NextResponse.json(
      { error: 'Tenant has no Stripe subscription' },
      { status: 400 }
    )
  }

  // Fetch fresh subscription from Stripe (expand latest_invoice for period dates)
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ['latest_invoice']
  })

  // Re-run the subscription change handler to sync all fields
  await handleSubscriptionChange(subscription)

  // Return updated tenant data
  const updatedDoc = await adminDb
    .collection(Collections.tenants)
    .doc(tenantId)
    .get()

  return NextResponse.json({
    subscription: updatedDoc.data()?.subscription ?? null,
    synced: true
  })
}
