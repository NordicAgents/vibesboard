import { NextResponse } from 'next/server'
import { stripe } from '@vibesboard/adapter-stripe/server'
import { requireTenantAdmin } from '@/lib/firebase/route-handler'
import { adminDb } from '@vibesboard/adapter-firebase/admin'
import { Collections } from '@vibesboard/contracts'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const body = await request.json()
  const { tenantId } = body as { tenantId: string }

  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
  }

  // Auth check
  const auth = await requireTenantAdmin(tenantId)
  if (!auth.ok) return auth.response

  // Get Stripe customer ID
  const tenantDoc = await adminDb
    .collection(Collections.tenants)
    .doc(tenantId)
    .get()

  const stripeCustomerId = tenantDoc.data()?.subscription?.stripeCustomerId
  if (!stripeCustomerId) {
    return NextResponse.json(
      { error: 'No billing account found. Subscribe to a plan first.' },
      { status: 400 }
    )
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${appUrl}/settings/tenant/billing`
  })

  return NextResponse.json({ url: session.url })
}
