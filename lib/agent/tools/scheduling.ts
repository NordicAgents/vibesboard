import { createHash } from 'crypto'
import { adminDb } from '@/lib/firebase/admin'
import {
  Collections,
  type AgentSchedulingConfig,
  type BookingDocument,
  type CalendarConnectionDocument
} from '@/lib/firestore-types'
import { createProvider } from '@/lib/scheduling/providers'
import { getValidAccessToken } from '@/lib/scheduling/connections'
import type { RegisteredTool } from './base'
import type { VibeAgent } from '@/lib/types'

interface SchedulingToolContext {
  agent: VibeAgent
  connection: CalendarConnectionDocument
  config: AgentSchedulingConfig
}

function formatSlotForDisplay(isoDate: string, timezone: string): string {
  try {
    return new Date(isoDate).toLocaleString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone,
      timeZoneName: 'short'
    })
  } catch {
    return isoDate
  }
}

/**
 * Deterministic booking document ID derived from the booking's natural key.
 * If the Google Calendar request times out and the tool is retried, the same
 * doc ID is generated — the existing booking is returned instead of creating a duplicate.
 */
function bookingDocId(agentId: string, startTime: string, attendeeEmail: string): string {
  return createHash('sha256')
    .update(`${agentId}|${startTime}|${attendeeEmail.toLowerCase()}`)
    .digest('hex')
    .slice(0, 32)
}

function buildCheckAvailabilityTool(ctx: SchedulingToolContext): RegisteredTool {
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
            description: `Meeting duration in minutes. Default: ${ctx.config.defaultDurationMinutes}`
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
          return `No available slots on ${date} for a ${durationMinutes}-minute meeting. Try a different date.`
        }

        const formatted = slots
          .slice(0, 8) // cap display to 8 slots
          .map(
            (slot, i) =>
              `${i + 1}. ${formatSlotForDisplay(slot.start, ctx.config.timezone)} — ${formatSlotForDisplay(slot.end, ctx.config.timezone)}`
          )
          .join('\n')

        return `Available ${durationMinutes}-minute slots on ${date}:\n${formatted}\n\n${slots.length > 8 ? `(${slots.length - 8} more slots available)` : ''}`
      } catch (error) {
        return `Error checking availability: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }
}

function buildBookMeetingTool(ctx: SchedulingToolContext): RegisteredTool {
  return {
    function: {
      name: 'book_meeting',
      description:
        'Book a meeting at a specific date and time. Always call check_availability first before using this tool.',
      parameters: {
        type: 'object',
        properties: {
          start_time: {
            type: 'string',
            description:
              'Meeting start time in ISO 8601 format (e.g., 2024-03-15T14:00:00).'
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
            description: 'Meeting title. Optional.'
          },
          description: {
            type: 'string',
            description: 'Meeting description or notes. Optional.'
          },
          duration_minutes: {
            type: 'number',
            description: `Duration in minutes. Default: ${ctx.config.defaultDurationMinutes}`
          }
        },
        required: ['start_time', 'attendee_name', 'attendee_email']
      }
    },
    execute: async (args) => {
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
      const endTime = new Date(startMs + durationMinutes * 60 * 1000).toISOString()

      // Build title from template
      const title = args.title
        ? String(args.title)
        : ctx.config.meetingTitleTemplate.replace('{{name}}', attendeeName)

      try {
        // Use a deterministic doc ID so retries after a timeout return the
        // existing booking rather than creating a duplicate calendar event.
        const docId = bookingDocId(ctx.agent.id, startTime, attendeeEmail)
        const bookingRef = adminDb
          .collection(Collections.bookings(ctx.agent.tenantId!, ctx.agent.id))
          .doc(docId)

        const existingSnap = await bookingRef.get()
        if (existingSnap.exists) {
          const existing = existingSnap.data() as BookingDocument
          const lines = [
            `Meeting already booked.`,
            `Title: ${existing.title}`,
            `Time: ${formatSlotForDisplay(existing.startTime, ctx.config.timezone)}`,
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
            : ctx.config.meetingDescription ?? undefined,
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
          `Meeting booked successfully!`,
          `Title: ${title}`,
          `Time: ${formatSlotForDisplay(startTime, ctx.config.timezone)}`,
          `Duration: ${durationMinutes} minutes`,
          `Attendee: ${attendeeName} (${attendeeEmail})`
        ]
        if (result.meetLink) {
          lines.push(`Google Meet: ${result.meetLink}`)
        }
        lines.push(`A calendar invite has been sent to ${attendeeEmail}.`)

        return lines.join('\n')
      } catch (error) {
        return `Error booking meeting: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }
}

function buildRescheduleMeetingTool(ctx: SchedulingToolContext): RegisteredTool {
  return {
    function: {
      name: 'reschedule_meeting',
      description:
        'Reschedule an existing meeting to a new time. Requires the attendee email and original start time to find the booking.',
      parameters: {
        type: 'object',
        properties: {
          attendee_email: {
            type: 'string',
            description: 'Email of the attendee whose meeting to reschedule.'
          },
          original_start_time: {
            type: 'string',
            description:
              'Original meeting start time in ISO 8601 format.'
          },
          new_start_time: {
            type: 'string',
            description: 'New meeting start time in ISO 8601 format.'
          },
          duration_minutes: {
            type: 'number',
            description: 'New duration in minutes. Optional — keeps original if omitted.'
          }
        },
        required: ['attendee_email', 'original_start_time', 'new_start_time']
      }
    },
    execute: async (args) => {
      const attendeeEmail = String(args.attendee_email ?? '').trim()
      const originalStartTime = String(args.original_start_time ?? '').trim()
      const newStartTime = String(args.new_start_time ?? '').trim()

      if (!attendeeEmail || !originalStartTime || !newStartTime) {
        return 'Missing required fields: attendee_email, original_start_time, and new_start_time.'
      }

      try {
        // Find the booking
        const bookingsPath = Collections.bookings(ctx.agent.tenantId!, ctx.agent.id)
        const snapshot = await adminDb
          .collection(bookingsPath)
          .where('attendeeEmail', '==', attendeeEmail)
          .where('status', 'in', ['confirmed', 'rescheduled'])
          .get()

        const booking = snapshot.docs
          .map((d: FirebaseFirestore.QueryDocumentSnapshot) => ({ id: d.id, ...d.data() } as BookingDocument))
          .find((b: BookingDocument) => {
            const bStart = new Date(b.startTime).getTime()
            const oStart = new Date(originalStartTime).getTime()
            return Math.abs(bStart - oStart) < 60_000 // within 1 minute tolerance
          })

        if (!booking) {
          return `No active booking found for ${attendeeEmail} at ${formatSlotForDisplay(originalStartTime, ctx.config.timezone)}.`
        }

        // Calculate new end time
        const originalDuration =
          new Date(booking.endTime).getTime() - new Date(booking.startTime).getTime()
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
          `Meeting rescheduled successfully!`,
          `Attendee: ${booking.attendeeName} (${attendeeEmail})`,
          `New time: ${formatSlotForDisplay(newStartTime, ctx.config.timezone)}`,
          `Duration: ${Math.round(durationMs / 60_000)} minutes`,
          `An updated calendar invite has been sent.`
        ].join('\n')
      } catch (error) {
        return `Error rescheduling meeting: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }
}

function buildCancelMeetingTool(ctx: SchedulingToolContext): RegisteredTool {
  return {
    function: {
      name: 'cancel_meeting',
      description:
        'Cancel an existing meeting. Requires the attendee email and start time to identify the booking.',
      parameters: {
        type: 'object',
        properties: {
          attendee_email: {
            type: 'string',
            description: 'Email of the attendee whose meeting to cancel.'
          },
          start_time: {
            type: 'string',
            description: 'Meeting start time in ISO 8601 format.'
          }
        },
        required: ['attendee_email', 'start_time']
      }
    },
    execute: async (args) => {
      const attendeeEmail = String(args.attendee_email ?? '').trim()
      const startTime = String(args.start_time ?? '').trim()

      if (!attendeeEmail || !startTime) {
        return 'Missing required fields: attendee_email and start_time.'
      }

      try {
        // Find the booking
        const bookingsPath = Collections.bookings(ctx.agent.tenantId!, ctx.agent.id)
        const snapshot = await adminDb
          .collection(bookingsPath)
          .where('attendeeEmail', '==', attendeeEmail)
          .where('status', 'in', ['confirmed', 'rescheduled'])
          .get()

        const booking = snapshot.docs
          .map((d: FirebaseFirestore.QueryDocumentSnapshot) => ({ id: d.id, ...d.data() } as BookingDocument))
          .find((b: BookingDocument) => {
            const bStart = new Date(b.startTime).getTime()
            const sStart = new Date(startTime).getTime()
            return Math.abs(bStart - sStart) < 60_000
          })

        if (!booking) {
          return `No active booking found for ${attendeeEmail} at ${formatSlotForDisplay(startTime, ctx.config.timezone)}.`
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
          `Meeting cancelled successfully.`,
          `Title: ${booking.title}`,
          `Was scheduled: ${formatSlotForDisplay(booking.startTime, ctx.config.timezone)}`,
          `Attendee: ${booking.attendeeName} (${attendeeEmail})`,
          `A cancellation notice has been sent.`
        ].join('\n')
      } catch (error) {
        return `Error cancelling meeting: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }
}

/**
 * Build all scheduling tools for an agent with an active calendar connection.
 */
export function buildSchedulingTools(
  agent: VibeAgent,
  connection: CalendarConnectionDocument
): RegisteredTool[] {
  const config = agent.schedulingConfig
  if (!config?.enabled) return []

  const ctx: SchedulingToolContext = { agent, connection, config }

  return [
    buildCheckAvailabilityTool(ctx),
    buildBookMeetingTool(ctx),
    buildRescheduleMeetingTool(ctx),
    buildCancelMeetingTool(ctx)
  ]
}
