import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  primaryKey,
} from 'drizzle-orm/pg-core'
import { tenants } from './tenants.ts'
import { users } from './users.ts'

export const tenantBranding = pgTable(
  'tenant_branding',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    logoUrl: text('logo_url'),
    primaryColor: text('primary_color').notNull().default('#0F62FE'),
    secondaryColor: text('secondary_color').notNull().default('#198038'),
    overrides: jsonb('overrides').$type<Array<'logoUrl' | 'primaryColor' | 'secondaryColor'>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId] }),
  }),
)

// Singleton — one row only, id is a fixed sentinel value at app level
export const platformBranding = pgTable('platform_branding', {
  id: uuid('id').primaryKey(),
  logoUrl: text('logo_url'),
  primaryColor: text('primary_color').notNull().default('#0F62FE'),
  secondaryColor: text('secondary_color').notNull().default('#198038'),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type TenantBranding = typeof tenantBranding.$inferSelect
export type PlatformBranding = typeof platformBranding.$inferSelect
