import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core'
import { tenants } from './tenants.ts'
import { agents } from './agents.ts'
import { users } from './users.ts'

export const files = pgTable(
  'files',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    fileKey: text('file_key').notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    fileSize: integer('file_size').notNull(),
    status: text('status', {
      enum: ['pending', 'processing', 'indexed', 'failed'],
    })
      .notNull()
      .default('pending'),
    processingError: text('processing_error'),
    processingStartedAt: timestamp('processing_started_at', { withTimezone: true }),
    processingCompletedAt: timestamp('processing_completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byAgent: index('files_agent_idx').on(t.agentId, t.status),
    byKey: index('files_key_idx').on(t.fileKey),
  }),
)

export type File = typeof files.$inferSelect
export type NewFile = typeof files.$inferInsert
