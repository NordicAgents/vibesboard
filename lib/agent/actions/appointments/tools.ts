// lib/agent/actions/appointments/tools.ts
import { createHash } from 'crypto'
import { adminDb } from '@/lib/firebase/admin'
import { Collections, type BookingDocument, type CalendarConnectionDocument } from '@/lib/firestore-types'
import { createProvider } from '@/lib/scheduling/providers'
import { getCalendarConnection, getValidAccessToken } from '@/lib/scheduling/connections'
import { formatSlotDisplay } from '../shared/calendar'
import type { RegisteredTool } from '@/lib/agent/tools/base'
import type { VibeAgent } from '@/lib/types'
import type { ActionContext } from '../types'
import type { AppointmentsConfig } from './types'

interface AppointmentsToolContext {
  agent: VibeAgent
  connection: CalendarConnectionDocument
  config: AppointmentsConfig
}

/**
 * Deterministic appointment document ID derived from the booking's natural key.
 * If the Google Calendar request times out and the tool is retried, the same
 * doc ID is generated — the existing booking is returned instead of creating a duplicate.
 */
function appointmentDocId(agentId: string, startTime: string, attendeeEmail: string): string {
  // Normalize startTime to canonical ISO form so that equivalent times expressed
  // differently (e.g. "2026-05-10T14:00:00" vs "2026-05-10T14:00:00.000Z") produce
  // the same hash and the idempotency check is not bypassed.
  const normalizedTime = new Date(startTime).toISOString()
  return createHash('sha256')
    .update(`${agentId}|${normalizedTime}|${attendeeEmail.toLowerCase()}`)
    .digest('hex')
    .slice(0, 32)
}

function buildCheckAvailabilityTool(ctx: AppointmentsToolContext): RegisteredTool {
  return {
    function: {
      name: 'check_availability',
      description:
        'Check calendar availability for a specific date. Returns available time slots for booking.',
      parameters: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description:
              'The date to check availability for, in YYYY-MM-DD format.'
          },
          duration_minutes: {
            type: 'number',
            description: `Appointment duration in minutes. Default: ${ctx.config.defaultDurationMinutes}`
          }
        },
        required: ['date']
      }
    },
    execute: async args => {
      const date = String(args.date ?? '').trim()
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return 'Please provide a valid date in YYYY-MM-DD format.'
      }

      const durationMinutes =
        typeof args.duration_minutes === 'number' && args.duration_minutes > 0
          ? args.duration_minutes
          : ctx.config.defaultDurationMinutes

      try {
        const accessToken = await getValidAccessToken(ctx.connection)
        const provider = createProvider(ctx.connection, accessToken)

        const slots = await provider.checkAvailability({
          date,
          durationMinutes,
          timezone: ctx.config.timezone,
          availableHours: ctx.config.availableHours,
          availableDays: ctx.config.availableDays,
          bufferMinutes: ctx.config.bufferMinutes
        })

        if (slots.length === 0) {
          return `No available slots on ${date} for a ${durationMinutes}-minute appointment. Try a different date.`
        }

        const formatted = slots
          .slice(0, 8) // cap display to 8 slots
          .map(
            (slot, i) =>
              `${i + 1}. ${formatSlotDisplay(slot.start, ctx.config.timezone)} — ${formatSlotDisplay(slot.end, ctx.config.timezone)}`
          )
          .join('\n')

        return `Available ${durationMinutes}-minute slots on ${date}:\n${formatted}\n\n${slots.length > 8 ? `(${slots.length - 8} more slots available)` : ''}`
      } catch (error) {
        return `Error checking availability: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }
}

function buildBookAppointmentTool(ctx: AppointmentsToolContext): RegisteredTool {
  return {
    function: {
      name: 'book_appointment',
      description:
        'Book an appointment at a specific date and time. Always call check_availability first before using this tool.',
      parameters: {
        type: 'object',
        properties: {
          start_time: {
            type: 'string',
            description:
              'Appointment start time in ISO 8601 format (e.g., 2024-03-15T14:00:00).'
          },
          attendee_name: {
            type: 'string',
            description: 'Full name of the attendee.'
          },
          attendee_email: {
            type: 'string',
            description: 'Email address of the attendee.'
          },
          title: {
            type: 'string',
            description: 'Appointment title. Optional.'
          },
          description: {
            type: 'string',
            description: 'Appointment description or notes. Optional.'
          },
          duration_minutes: {
            type: 'number',
            description: `Duration in minutes. Default: ${ctx.config.defaultDurationMinutes}`
          }
        },
        required: ['start_time', 'attendee_name', 'attendee_email']
      }
    },
    execute: async args => {
      const startTime = String(args.start_time ?? '').trim()
      const attendeeName = String(args.attendee_name ?? '').trim()
      const attendeeEmail = String(args.attendee_email ?? '').trim()

      if (!startTime || !attendeeName || !attendeeEmail) {
        return 'Missing required fields: start_time, attendee_name, and attendee_email are all required.'
      }

      const durationMinutes =
        typeof args.duration_minutes === 'number' && args.duration_minutes > 0
          ? args.duration_minutes
          : ctx.config.defaultDurationMinutes

      // Compute end time
      const startMs = new Date(startTime).getTime()
      if (isNaN(startMs)) {
        return 'Invalid start_time format. Use ISO 8601 (e.g., 2024-03-15T14:00:00).'
      }
      const endTime = new Date(
        startMs + durationMinutes * 60 * 1000
      ).toISOString()

      // Build title from template
      const title = args.title
        ? String(args.title)
        : ctx.config.meetingTitleTemplate.replace('{{name}}', attendeeName)

      try {
        // Use a deterministic doc ID so retries after a timeout return the
        // existing booking rather than creating a duplicate calendar event.
        const docId = appointmentDocId(ctx.agent.id, startTime, attendeeEmail)
        const bookingRef = adminDb
          .collection(Collections.bookings(ctx.agent.tenantId!, ctx.agent.id))
          .doc(docId)

        const existingSnap = await bookingRef.get()
        if (existingSnap.exists) {
          const existing = existingSnap.data() as BookingDocument
          const lines = [
            `Appointment already booked.`,
            `Title: ${existing.title}`,
            `Time: ${formatSlotDisplay(existing.startTime, ctx.config.timezone)}`,
            `Duration: ${Math.round((new Date(existing.endTime).getTime() - new Date(existing.startTime).getTime()) / 60_000)} minutes`,
            `Attendee: ${existing.attendeeName} (${existing.attendeeEmail})`
          ]
          if (existing.meetLink) lines.push(`Google Meet: ${existing.meetLink}`)
          return lines.join('\n')
        }

        const accessToken = await getValidAccessToken(ctx.connection)
        const provider = createProvider(ctx.connection, accessToken)

        const result = await provider.createEvent({
          title,
          startTime,
          endTime,
          attendeeEmail,
          attendeeName,
          description: args.description
            ? String(args.description)
            : (ctx.config.meetingDescription ?? undefined),
          timezone: ctx.config.timezone,
          createMeetLink: ctx.config.createMeetLink
        })

        // Store booking record with deterministic ID for idempotency
        const now = new Date().toISOString()
        const booking: BookingDocument = {
          id: docId,
          agentId: ctx.agent.id,
          tenantId: ctx.agent.tenantId!,
          conversationId: '', // populated by caller if available
          calendarConnectionId: ctx.connection.id,
          provider: ctx.connection.provider,
          externalEventId: result.eventId,
          title,
          startTime,
          endTime,
          timezone: ctx.config.timezone,
          attendeeName,
          attendeeEmail,
          description: args.description ? String(args.description) : undefined,
          meetLink: result.meetLink,
          status: 'confirmed',
          createdAt: now,
          updatedAt: now
        }
        await bookingRef.set(booking)

        // Format confirmation
        const lines = [
          `Appointment booked successfully!`,
          `Title: ${title}`,
          `Time: ${formatSlotDisplay(startTime, ctx.config.timezone)}`,
          `Duration: ${durationMinutes} minutes`,
          `Attendee: ${attendeeName} (${attendeeEmail})`
        ]
        if (result.meetLink) {
          lines.push(`Google Meet: ${result.meetLink}`)
        }
        lines.push(`A calendar invite has been sent to ${attendeeEmail}.`)

        return lines.join('\n')
      } catch (error) {
        return `Error booking appointment: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }
}

function buildRescheduleAppointmentTool(ctx: AppointmentsToolContext): RegisteredTool {
  return {
    function: {
      name: 'reschedule_appointment',
      description:
        'Reschedule an existing appointment to a new time. Requires the attendee email and original start time to find the booking.',
      parameters: {
        type: 'object',
        properties: {
          attendee_email: {
            type: 'string',
            description: 'Email of the attendee whose appointment to reschedule.'
          },
          original_start_time: {
            type: 'string',
            description:
              'Original appointment start time in ISO 8601 format.'
          },
          new_start_time: {
            type: 'string',
            description: 'New appointment start time in ISO 8601 format.'
          },
          duration_minutes: {
            type: 'number',
            description:
              'New duration in minutes. Optional — keeps original if omitted.'
          }
        },
        required: ['attendee_email', 'original_start_time', 'new_start_time']
      }
    },
    execute: async args => {
      const attendeeEmail = String(args.attendee_email ?? '').trim()
      const originalStartTime = String(args.original_start_time ?? '').trim()
      const newStartTime = String(args.new_start_time ?? '').trim()

      if (!attendeeEmail || !originalStartTime || !newStartTime) {
        return 'Missing required fields: attendee_email, original_start_time, and new_start_time.'
      }

      try {
        // Find the booking
        const bookingsPath = Collections.bookings(
          ctx.agent.tenantId!,
          ctx.agent.id
        )
        const snapshot = await adminDb
          .collection(bookingsPath)
          .where('attendeeEmail', '==', attendeeEmail)
          .where('status', 'in', ['confirmed', 'rescheduled'])
          .get()

        const booking = snapshot.docs
          .map(
            (d: FirebaseFirestore.QueryDocumentSnapshot) =>
              ({ id: d.id, ...d.data() }) as BookingDocument
          )
          .find((b: BookingDocument) => {
            const bStart = new Date(b.startTime).getTime()
            const oStart = new Date(originalStartTime).getTime()
            return Math.abs(bStart - oStart) < 60_000 // within 1 minute tolerance
          })

        if (!booking) {
          return `No active appointment found for ${attendeeEmail} at ${formatSlotDisplay(originalStartTime, ctx.config.timezone)}.`
        }

        // Calculate new end time
        const originalDuration =
          new Date(booking.endTime).getTime() -
          new Date(booking.startTime).getTime()
        const durationMs =
          typeof args.duration_minutes === 'number' && args.duration_minutes > 0
            ? args.duration_minutes * 60_000
            : originalDuration
        const newEndTime = new Date(
          new Date(newStartTime).getTime() + durationMs
        ).toISOString()

        const accessToken = await getValidAccessToken(ctx.connection)
        const provider = createProvider(ctx.connection, accessToken)

        await provider.updateEvent(booking.externalEventId, {
          startTime: newStartTime,
          endTime: newEndTime,
          timezone: ctx.config.timezone
        })

        // Update booking record
        await adminDb.collection(bookingsPath).doc(booking.id).update({
          startTime: newStartTime,
          endTime: newEndTime,
          status: 'rescheduled',
          updatedAt: new Date().toISOString()
        })

        return [
          `Appointment rescheduled successfully!`,
          `Attendee: ${booking.attendeeName} (${attendeeEmail})`,
          `New time: ${formatSlotDisplay(newStartTime, ctx.config.timezone)}`,
          `Duration: ${Math.round(durationMs / 60_000)} minutes`,
          `An updated calendar invite has been sent.`
        ].join('\n')
      } catch (error) {
        return `Error rescheduling appointment: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }
}

function buildCancelAppointmentTool(ctx: AppointmentsToolContext): RegisteredTool {
  return {
    function: {
      name: 'cancel_appointment',
      description:
        'Cancel an existing appointment. Requires the attendee email and start time to identify the booking.',
      parameters: {
        type: 'object',
        properties: {
          attendee_email: {
            type: 'string',
            description: 'Email of the attendee whose appointment to cancel.'
          },
          start_time: {
            type: 'string',
            description: 'Appointment start time in ISO 8601 format.'
          }
        },
        required: ['attendee_email', 'start_time']
      }
    },
    execute: async args => {
      const attendeeEmail = String(args.attendee_email ?? '').trim()
      const startTime = String(args.start_time ?? '').trim()

      if (!attendeeEmail || !startTime) {
        return 'Missing required fields: attendee_email and start_time.'
      }

      try {
        // Find the booking
        const bookingsPath = Collections.bookings(
          ctx.agent.tenantId!,
          ctx.agent.id
        )
        const snapshot = await adminDb
          .collection(bookingsPath)
          .where('attendeeEmail', '==', attendeeEmail)
          .where('status', 'in', ['confirmed', 'rescheduled'])
          .get()

        const booking = snapshot.docs
          .map(
            (d: FirebaseFirestore.QueryDocumentSnapshot) =>
              ({ id: d.id, ...d.data() }) as BookingDocument
          )
          .find((b: BookingDocument) => {
            const bStart = new Date(b.startTime).getTime()
            const sStart = new Date(startTime).getTime()
            return Math.abs(bStart - sStart) < 60_000
          })

        if (!booking) {
          return `No active appointment found for ${attendeeEmail} at ${formatSlotDisplay(startTime, ctx.config.timezone)}.`
        }

        const accessToken = await getValidAccessToken(ctx.connection)
        const provider = createProvider(ctx.connection, accessToken)

        await provider.deleteEvent(booking.externalEventId)

        // Update booking record
        await adminDb.collection(bookingsPath).doc(booking.id).update({
          status: 'cancelled',
          cancelledAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })

        return [
          `Appointment cancelled successfully.`,
          `Title: ${booking.title}`,
          `Was scheduled: ${formatSlotDisplay(booking.startTime, ctx.config.timezone)}`,
          `Attendee: ${booking.attendeeName} (${attendeeEmail})`,
          `A cancellation notice has been sent.`
        ].join('\n')
      } catch (error) {
        return `Error cancelling appointment: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }
}

function buildListAppointmentsTool(ctx: AppointmentsToolContext): RegisteredTool {
  return {
    function: {
      name: 'list_appointments',
      description:
        'List appointments for a specific date. Optionally filter by attendee email.',
      parameters: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'The date to list appointments for, in YYYY-MM-DD format.'
          },
          attendee_email: {
            type: 'string',
            description: 'Optional. Filter results to a specific attendee email.'
          }
        },
        required: ['date']
      }
    },
    execute: async (args) => {
      const date = String(args.date ?? '').trim()
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return 'Please provide a valid date in YYYY-MM-DD format.'
      }

      const attendeeEmail = args.attendee_email
        ? String(args.attendee_email).trim().toLowerCase()
        : null

      try {
        // Build a time range spanning the full day in the configured timezone.
        // We query for appointments whose startTime falls within [dayStart, dayEnd).
        const dayStart = new Date(`${date}T00:00:00Z`).toISOString()
        const dayEnd = new Date(`${date}T23:59:59.999Z`).toISOString()

        const bookingsPath = Collections.bookings(ctx.agent.tenantId!, ctx.agent.id)
        let query = adminDb
          .collection(bookingsPath)
          .where('startTime', '>=', dayStart)
          .where('startTime', '<=', dayEnd)
          .where('status', 'in', ['confirmed', 'rescheduled'])

        const snapshot = await query.get()

        let bookings = snapshot.docs.map(
          (d: FirebaseFirestore.QueryDocumentSnapshot) => ({ id: d.id, ...d.data() } as BookingDocument)
        )

        // Apply optional email filter in-memory (avoids a composite index requirement)
        if (attendeeEmail) {
          bookings = bookings.filter(
            (b: BookingDocument) => b.attendeeEmail.toLowerCase() === attendeeEmail
          )
        }

        // Sort by start time ascending
        bookings.sort(
          (a: BookingDocument, b: BookingDocument) =>
            new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
        )

        if (bookings.length === 0) {
          const suffix = attendeeEmail ? ` for ${attendeeEmail}` : ''
          return `No appointments found on ${date}${suffix}.`
        }

        const lines = [`Appointments on ${date}:`]
        bookings.forEach((b: BookingDocument, i: number) => {
          const duration = Math.round(
            (new Date(b.endTime).getTime() - new Date(b.startTime).getTime()) / 60_000
          )
          lines.push(
            `${i + 1}. ${formatSlotDisplay(b.startTime, ctx.config.timezone)} (${duration} min) — ${b.title} | ${b.attendeeName} (${b.attendeeEmail})`
          )
        })

        return lines.join('\n')
      } catch (error) {
        return `Error listing appointments: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }
}

/**
 * Build all appointment tools for an agent action with an active calendar connection.
 * Resolves the calendar connection from ctx.action.connectionId.
 */
export async function buildAppointmentsTools(ctx: ActionContext): Promise<RegisteredTool[]> {
  const { agent, action } = ctx

  if (!action.connectionId) {
    return []
  }

  const connection = await getCalendarConnection(agent.tenantId!, action.connectionId)
  if (!connection) {
    return []
  }

  const config = action.config as AppointmentsConfig

  const toolCtx: AppointmentsToolContext = { agent, connection, config }

  return [
    buildCheckAvailabilityTool(toolCtx),
    buildBookAppointmentTool(toolCtx),
    buildRescheduleAppointmentTool(toolCtx),
    buildCancelAppointmentTool(toolCtx),
    buildListAppointmentsTool(toolCtx)
  ]
}
