import { adminDb } from '@vibesboard/adapter-firebase/admin'
import {
  Collections,
  type BookingEnquiryDocument,
  type VibeAgent
} from '@vibesboard/contracts'
import { notifyAdminOfEnquiry } from './notify.ts'

export interface CreateEnquiryParams {
  agent: VibeAgent
  resourceName: string
  calendarId: string
  calendarName: string
  timezone: string
  startDatetime: string
  endDatetime: string
  guestName: string
  guestEmail: string
  guestPhone: string
  guestCount?: number
  notes?: string
}

export async function createEnquiry(
  params: CreateEnquiryParams
): Promise<string> {
  const now = new Date().toISOString()
  const ref = adminDb
    .collection(
      Collections.bookingEnquiries(params.agent.tenantId!, params.agent.id)
    )
    .doc()

  const doc: BookingEnquiryDocument = {
    id: ref.id,
    agentId: params.agent.id,
    tenantId: params.agent.tenantId!,
    resourceName: params.resourceName,
    calendarId: params.calendarId,
    calendarName: params.calendarName,
    timezone: params.timezone,
    startDatetime: params.startDatetime,
    endDatetime: params.endDatetime,
    guestName: params.guestName,
    guestEmail: params.guestEmail,
    guestPhone: params.guestPhone,
    guestCount: params.guestCount,
    notes: params.notes,
    createdAt: now
  }

  await ref.set(doc)

  // Fire-and-forget — email failure must not break the guest's submission
  notifyAdminOfEnquiry(params.agent, doc).catch(err =>
    console.error('[booking-enquiry] Failed to notify admin:', err)
  )

  return ref.id
}
