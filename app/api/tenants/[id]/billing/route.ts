import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/firebase/route-handler'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { stripe } from '@/lib/stripe'
import { getPlanTemplate, getAllPlanTemplates, type PlanId } from '@/lib/plans'

export const runtime = 'nodejs'

type RouteParams = { params: Promise<{ id: string }> }

/**
 * GET /api/tenants/[id]/billing
 * Returns billing data for the tenant: subscription, plan, invoices, etc.
 */
export async function GET(req: Request, { params }: RouteParams) {
  const { id: tenantId } = await params

  const auth = await requireTenantMember(tenantId)
  if (!auth.ok) return auth.response

  const tenantDoc = await adminDb
    .collection(Collections.tenants)
    .doc(tenantId)
    .get()
  if (!tenantDoc.exists) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  const tenant = tenantDoc.data()!
  const subscription = tenant.subscription ?? null

  // Fetch plan template
  let plan = null
  if (subscription?.planId) {
    plan = await getPlanTemplate(subscription.planId as PlanId)
  }

  // Fetch all plans for comparison grid
  const allPlans = await getAllPlanTemplates()

  // Fetch Stripe data if customer exists
  let hasPaymentMethod = false
  let invoices: Array<{
    id: string
    date: string
    amount: number
    status: string
    pdfUrl: string | null
  }> = []

  if (subscription?.stripeCustomerId) {
    try {
      // Check for payment methods
      const paymentMethods = await stripe.paymentMethods.list({
        customer: subscription.stripeCustomerId,
        type: 'card',
        limit: 1,
      })
      hasPaymentMethod = paymentMethods.data.length > 0

      // Fetch recent invoices
      const stripeInvoices = await stripe.invoices.list({
        customer: subscription.stripeCustomerId,
        limit: 5,
      })
      invoices = stripeInvoices.data.map((inv) => ({
        id: inv.id,
        date: new Date((inv.created ?? 0) * 1000).toISOString(),
        amount: inv.amount_paid ?? 0,
        status: inv.status ?? 'unknown',
        pdfUrl: inv.invoice_pdf ?? null,
      }))
    } catch (err) {
      console.error('[billing] Failed to fetch Stripe data:', err)
    }
  }

  return NextResponse.json({
    subscription,
    plan,
    allPlans,
    hasPaymentMethod,
    invoices,
  })
}
