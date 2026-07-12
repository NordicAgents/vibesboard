import { pgTable, uuid, text, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { tenants } from './tenants.ts'

export const tenantLlmConfigs = pgTable(
  'tenant_llm_configs',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    kind: text('kind', { enum: ['openai', 'anthropic', 'openai_compatible', 'google'] })
      .notNull()
      .$type<'openai' | 'anthropic' | 'openai_compatible' | 'google'>(),
    modelId: text('model_id').notNull(),
    baseUrl: text('base_url'),
    apiKeyEncrypted: text('api_key_encrypted'),
    isEnabled: boolean('is_enabled').notNull().default(true),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTenant: index('tenant_llm_configs_tenant_idx').on(t.tenantId),
  }),
)

export type TenantLlmConfigRow = typeof tenantLlmConfigs.$inferSelect
export type NewTenantLlmConfig = typeof tenantLlmConfigs.$inferInsert
