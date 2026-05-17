import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/firebase/route-handler'
import { adminDb } from '@vibesboard/adapter-firebase/admin'
import { Collections, type BookingEnquiryDocument } from '@vibesboard/contracts'
import { getActiveTenant } from '@/lib/tenant-context'

export const runtime = 'nodejs'

/**
 * GET /api/booking-enquiries?agentId=xxx
 * List all booking enquiries for an agent, newest first.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const tenantId = await getActiveTenant(authResult.user.id)
  if (!tenantId)
    return NextResponse.json({ error: 'No active tenant' }, { status: 403 })

  const agentId = new URL(req.url).searchParams.get('agentId')
  if (!agentId)
    return NextResponse.json({ error: 'agentId is required' }, { status: 400 })

  // Verify the agent belongs to this tenant to prevent cross-tenant data access
  const agentDoc = await adminDb
    .collection(Collections.agents(tenantId))
    .doc(agentId)
    .get()
  if (!agentDoc.exists)
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const snap = await adminDb
    .collection(Collections.bookingEnquiries(tenantId, agentId))
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get()

  const enquiries = snap.docs.map((d: any) => d.data() as BookingEnquiryDocument)

  return NextResponse.json({ enquiries })
}
