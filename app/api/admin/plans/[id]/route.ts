import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/firebase/route-handler'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'

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
    return NextResponse.json({ error: 'Plan template not found' }, { status: 404 })
  }

  return NextResponse.json({ plan: { id: snap.id, ...snap.data() } })
}

/**
 * PUT /api/admin/plans/[id]
 * Update plan template fields (SUPER_ADMIN only)
 */
export async function PUT(req: Request, { params }: RouteParams) {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const body = await req.json()

  const ref = adminDb.collection(Collections.planTemplates).doc(id)
  const snap = await ref.get()

  if (!snap.exists) {
    return NextResponse.json({ error: 'Plan template not found' }, { status: 404 })
  }

  const updates: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  }

  if (body.name !== undefined) updates.name = body.name
  if (body.price !== undefined) updates.price = Number(body.price)
  if (body.pricePerSeat !== undefined) updates.pricePerSeat = body.pricePerSeat === null ? null : Number(body.pricePerSeat)
  if (body.minSeats !== undefined) updates.minSeats = body.minSeats === null ? null : Number(body.minSeats)
  if (body.includedMessages !== undefined) updates.includedMessages = Number(body.includedMessages)
  if (body.includedMessagesPerSeat !== undefined) updates.includedMessagesPerSeat = body.includedMessagesPerSeat === null ? null : Number(body.includedMessagesPerSeat)
  if (body.overageRate !== undefined) updates.overageRate = Number(body.overageRate)
  if (body.featureFlags !== undefined) updates.featureFlags = Array.isArray(body.featureFlags) ? body.featureFlags : []

  await ref.update(updates)

  const updated = await ref.get()
  return NextResponse.json({ plan: { id: updated.id, ...updated.data() } })
}
