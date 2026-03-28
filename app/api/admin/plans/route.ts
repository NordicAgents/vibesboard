import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/firebase/route-handler'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'

export const runtime = 'nodejs'

/**
 * GET /api/admin/plans
 * List all plan templates with tenant counts (SUPER_ADMIN only)
 */
export async function GET() {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response

  const plansSnap = await adminDb.collection(Collections.planTemplates).get()
  const plans = plansSnap.docs.map((d: FirebaseFirestore.QueryDocumentSnapshot) => ({ id: d.id, ...d.data() }))

  // Count tenants per plan
  const tenantsSnap = await adminDb.collection(Collections.tenants).get()
  const countByPlan: Record<string, number> = {}
  for (const doc of tenantsSnap.docs) {
    const planId = doc.data()?.subscription?.planId
    if (planId) {
      countByPlan[planId] = (countByPlan[planId] ?? 0) + 1
    }
  }

  const plansWithCounts = plans.map((p: { id: string; [key: string]: unknown }) => ({
    ...p,
    tenantCount: countByPlan[p.id] ?? 0,
  }))

  // Sort: free, pro, team, enterprise
  const order = ['free', 'pro', 'team', 'enterprise']
  plansWithCounts.sort((a: { id: string }, b: { id: string }) => order.indexOf(a.id) - order.indexOf(b.id))

  return NextResponse.json({ plans: plansWithCounts })
}

/**
 * POST /api/admin/plans
 * Create a new plan template (SUPER_ADMIN only)
 */
export async function POST(req: Request) {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response

  const body = await req.json()
  const { id, name, price, pricePerSeat, minSeats, includedMessages, includedMessagesPerSeat, overageRate, featureFlags } = body

  if (!id || !name) {
    return NextResponse.json({ error: 'id and name are required' }, { status: 400 })
  }

  // Check for duplicate
  const existing = await adminDb.collection(Collections.planTemplates).doc(id).get()
  if (existing.exists) {
    return NextResponse.json({ error: 'Plan template already exists' }, { status: 409 })
  }

  const now = new Date().toISOString()
  const doc = {
    id,
    name,
    price: price ?? 0,
    pricePerSeat: pricePerSeat ?? null,
    minSeats: minSeats ?? null,
    includedMessages: includedMessages ?? 0,
    includedMessagesPerSeat: includedMessagesPerSeat ?? null,
    overageRate: overageRate ?? 0,
    featureFlags: featureFlags ?? [],
    createdAt: now,
    updatedAt: now,
  }

  await adminDb.collection(Collections.planTemplates).doc(id).set(doc)

  return NextResponse.json({ plan: doc }, { status: 201 })
}
