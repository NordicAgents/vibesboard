import { adminDb } from '@/lib/firebase/admin'
import { Collections, type BookingEnquiryDocument } from '@/lib/firestore-types'
import { generateIcs } from './ics'
import type { VibeAgent } from '@/lib/types'

export async function notifyAdminOfEnquiry(
  agent: VibeAgent,
  enquiry: BookingEnquiryDocument
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn(
      '[booking-enquiry] RESEND_API_KEY not set — skipping admin email'
    )
    return
  }

  // Resolve admin email: notificationConfig → agent owner's account email
  let toAddress: string | null = null
  const notifConfig = agent.notificationConfig
  if (notifConfig?.email?.enabled && notifConfig.email.address) {
    toAddress = notifConfig.email.address
  }
  if (!toAddress && agent.userId) {
    const userDoc = await adminDb
      .collection(Collections.users)
      .doc(agent.userId)
      .get()
    toAddress = userDoc.data()?.email ?? null
  }
  if (!toAddress) {
    console.warn(
      '[booking-enquiry] No admin email address found — skipping notification'
    )
    return
  }

  // iso is a wall-clock string ("2026-05-10T14:00") already in enquiry.timezone.
  // Parse the components directly and format at UTC to avoid any timezone shift.
  const fmt = (iso: string) => {
    const [datePart, timePart = '00:00'] = iso.split('T')
    const [year, month, day] = datePart.split('-').map(Number)
    const [hour, minute] = timePart.split(':').map(Number)
    return new Date(
      Date.UTC(year, month - 1, day, hour, minute || 0)
    ).toLocaleString('en-US', {
      timeZone: 'UTC',
      dateStyle: 'medium',
      timeStyle: 'short'
    })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  const body = [
    `New booking enquiry received for ${enquiry.resourceName}.`,
    '',
    `Guest: ${enquiry.guestName}`,
    `Email: ${enquiry.guestEmail}`,
    `Phone: ${enquiry.guestPhone}`,
    enquiry.guestCount ? `Guests: ${enquiry.guestCount}` : null,
    '',
    `Resource: ${enquiry.resourceName}`,
    `Dates: ${fmt(enquiry.startDatetime)} → ${fmt(enquiry.endDatetime)} (${enquiry.timezone})`,
    enquiry.notes ? `Notes: ${enquiry.notes}` : null,
    '',
    `Add to calendar: ${enquiry.calendarName}`,
    '',
    `View all enquiries: ${appUrl}/agents/${agent.id}?tab=booking-enquiries`
  ]
    .filter(s => s !== null)
    .join('\n')

  const icsContent = generateIcs({
    uid: enquiry.id,
    summary: `${enquiry.resourceName} — ${enquiry.guestName}`,
    description: [
      `Guest: ${enquiry.guestName}`,
      `Email: ${enquiry.guestEmail}`,
      `Phone: ${enquiry.guestPhone}`,
      enquiry.guestCount ? `Guests: ${enquiry.guestCount}` : null,
      enquiry.notes ? `Notes: ${enquiry.notes}` : null,
      '',
      `Add to calendar: ${enquiry.calendarName}`,
      `Calendar ID: ${enquiry.calendarId}`
    ]
      .filter(s => s !== null)
      .join('\n'),
    startDatetime: enquiry.startDatetime,
    endDatetime: enquiry.endDatetime,
    timezone: enquiry.timezone,
    organizerEmail: toAddress
  })

  const { Resend } = await import('resend')
  await new Resend(apiKey).emails.send({
    from:
      process.env.NOTIFICATION_EMAIL_FROM ||
      'VibeAgent <notifications@vibeagent.com>',
    to: toAddress,
    subject: `New booking enquiry — ${enquiry.resourceName}`,
    text: body,
    attachments: [
      {
        filename: `booking-${enquiry.id}.ics`,
        content: Buffer.from(icsContent).toString('base64'),
        contentType: 'text/calendar; method=REQUEST'
      }
    ]
  })
}
