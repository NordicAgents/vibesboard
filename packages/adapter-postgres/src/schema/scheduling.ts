import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core'
import { tenants } from './tenants.ts'
import { agents } from './agents.ts'
import { conversations } from './conversations.ts'
import { users } from './users.ts'

export const calendarConnections = pgTable(
  'calendar_connections',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    provider: text('provider', { enum: ['google_calendar', 'cal_com'] }).notNull(),
    name: text('name').notNull(),
    calendarId: text('calendar_id').notNull(),
    accessTokenEncrypted: text('access_token_encrypted').notNull(),
    refreshTokenEncrypted: text('refresh_token_encrypted').notNull(),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    apiKeyEncrypted: text('api_key_encrypted'),
    apiBaseUrl: text('api_base_url'),
    email: text('email'),
    scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
    status: text('status', {
      enum: ['active', 'disconnected', 'expired'],
    })
      .notNull()
      .default('active'),
    connectedBy: uuid('connected_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTenant: index('calendar_connections_tenant_idx').on(t.tenantId),
  }),
)

export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),
    calendarConnectionId: uuid('calendar_connection_id')
      .notNull()
      .references(() => calendarConnections.id, { onDelete: 'cascade' }),
    provider: text('provider', { enum: ['google_calendar', 'cal_com'] }).notNull(),
    externalEventId: text('external_event_id').notNull(),
    title: text('title').notNull(),
    startTime: timestamp('start_time', { withTimezone: true }).notNull(),
    endTime: timestamp('end_time', { withTimezone: true }).notNull(),
    timezone: text('timezone').notNull(),
    attendeeName: text('attendee_name').notNull(),
    attendeeEmail: text('attendee_email').notNull(),
    description: text('description'),
    meetLink: text('meet_link'),
    status: text('status', {
      enum: ['confirmed', 'cancelled', 'rescheduled'],
    })
      .notNull()
      .default('confirmed'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    rescheduledTo: uuid('rescheduled_to'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byAgent: index('bookings_agent_idx').on(t.agentId, t.startTime),
    byCal: index('bookings_calendar_idx').on(t.calendarConnectionId, t.startTime),
  }),
)

export const bookingEnquiries = pgTable(
  'booking_enquiries',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    resourceName: text('resource_name').notNull(),
    calendarId: text('calendar_id').notNull(),
    calendarName: text('calendar_name').notNull(),
    timezone: text('timezone').notNull(),
    startDatetime: timestamp('start_datetime', { withTimezone: true }).notNull(),
    endDatetime: timestamp('end_datetime', { withTimezone: true }).notNull(),
    guestName: text('guest_name').notNull(),
    guestEmail: text('guest_email').notNull(),
    guestPhone: text('guest_phone').notNull(),
    guestCount: integer('guest_count'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byAgent: index('booking_enquiries_agent_idx').on(t.agentId, t.createdAt),
  }),
)

export type CalendarConnection = typeof calendarConnections.$inferSelect
export type Booking = typeof bookings.$inferSelect
export type BookingEnquiry = typeof bookingEnquiries.$inferSelect
