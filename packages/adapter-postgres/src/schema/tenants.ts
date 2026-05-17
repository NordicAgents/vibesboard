import {
  pgTable,
  uuid,
  text,
  jsonb,
  boolean,
  timestamp,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core'
import { users } from './users.ts'

type TenantBrandingJson = {
  logoUrl?: string
  primaryColor?: string
  secondaryColor?: string
  overrides?: Array<'logoUrl' | 'primaryColor' | 'secondaryColor'>
}

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  status: text('status', { enum: ['active', 'pending', 'trial', 'suspended'] })
    .notNull()
    .default('active'),
  planId: text('plan_id').notNull().default('self_hosted'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  isPersonal: boolean('is_personal').notNull().default(false),
  googlePlaceId: text('google_place_id'),
  branding: jsonb('branding').$type<TenantBrandingJson>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const tenantMembers = pgTable(
  'tenant_members',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', {
      enum: ['SUPER_ADMIN', 'TENANT_ADMIN', 'MEMBER'],
    }).notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.userId] }),
    byUser: index('tenant_members_user_idx').on(t.userId),
  }),
)

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    token: text('token').notNull().unique(),
    role: text('role', { enum: ['TENANT_ADMIN', 'MEMBER'] }).notNull(),
    status: text('status', { enum: ['pending', 'accepted', 'expired'] })
      .notNull()
      .default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTenant: index('invitations_tenant_idx').on(t.tenantId),
    byEmail: index('invitations_email_idx').on(t.email),
  }),
)

export type Tenant = typeof tenants.$inferSelect
export type NewTenant = typeof tenants.$inferInsert
export type TenantMember = typeof tenantMembers.$inferSelect
export type Invitation = typeof invitations.$inferSelect
