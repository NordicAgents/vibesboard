// lib/agent/actions/appointments/tools.ts
import { type CalendarConnectionDocument } from '@vibesboard/contracts'
import { createProvider } from '@vibesboard/scheduling/providers'
import { getCalendarConnection, getValidAccessToken } from '@vibesboard/scheduling/connections'
import {
  upsertBooking,
  findActiveBookingByAttendee,
  setBookingStatus,
  listBookingsForDay,
} from '@vibesboard/scheduling/bookings'
import { formatSlotDisplay } from '../shared/calendar.ts'
import type { RegisteredTool } from '@vibesboard/ai/tools/base'
import type { VibeAgent } from '@vibesboard/contracts'
import type { ActionContext } from '../types.ts'
import type { AppointmentsConfig } from './types.ts'

interface AppointmentsToolContext {
  agent: VibeAgent
  connection: CalendarConnectionDocument
  config: AppointmentsConfig
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

        // Idempotent on (agent, start, email): a timeout-retry returns the
        // pre-existing active booking instead of creating a duplicate.
        const booking = await upsertBooking({
          tenantId: ctx.agent.tenantId!,
          agentId: ctx.agent.id,
          calendarConnectionId: ctx.connection.id,
          provider: ctx.connection.provider,
          externalEventId: result.eventId,
          title,
          startTime,
          endTime,
          timezone: ctx.config.timezone,
          attendeeName,
          attendeeEmail,
          description: args.description
            ? String(args.description)
            : (ctx.config.meetingDescription ?? undefined),
          meetLink: result.meetLink
        })

        // Format confirmation from the persisted booking (new or pre-existing).
        const lines = [
          `Appointment booked successfully!`,
          `Title: ${booking.title}`,
          `Time: ${formatSlotDisplay(booking.startTime, ctx.config.timezone)}`,
          `Duration: ${durationMinutes} minutes`,
          `Attendee: ${booking.attendeeName} (${booking.attendeeEmail})`
        ]
        if (booking.meetLink) {
          lines.push(`Google Meet: ${booking.meetLink}`)
        }
        lines.push(`A calendar invite has been sent to ${booking.attendeeEmail}.`)

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
        const booking = await findActiveBookingByAttendee(
          ctx.agent.tenantId!,
          ctx.agent.id,
          attendeeEmail,
          originalStartTime
        )

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
        await setBookingStatus(ctx.agent.tenantId!, booking.id, {
          status: 'rescheduled',
          startTime: newStartTime,
          endTime: newEndTime
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
        const booking = await findActiveBookingByAttendee(
          ctx.agent.tenantId!,
          ctx.agent.id,
          attendeeEmail,
          startTime
        )

        if (!booking) {
          return `No active appointment found for ${attendeeEmail} at ${formatSlotDisplay(startTime, ctx.config.timezone)}.`
        }

        const accessToken = await getValidAccessToken(ctx.connection)
        const provider = createProvider(ctx.connection, accessToken)

        await provider.deleteEvent(booking.externalEventId)

        // Update booking record
        await setBookingStatus(ctx.agent.tenantId!, booking.id, {
          status: 'cancelled',
          cancelledAt: new Date().toISOString()
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
        // Helper queries the day range, filters by attendee, and sorts ascending.
        const bookings = await listBookingsForDay(
          ctx.agent.tenantId!,
          ctx.agent.id,
          date,
          attendeeEmail
        )

        if (bookings.length === 0) {
          const suffix = attendeeEmail ? ` for ${attendeeEmail}` : ''
          return `No appointments found on ${date}${suffix}.`
        }

        const lines = [`Appointments on ${date}:`]
        bookings.forEach((b, i) => {
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
