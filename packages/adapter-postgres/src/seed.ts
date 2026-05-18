#!/usr/bin/env node
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { uuidv7 } from 'uuidv7'
import * as schema from './schema/index.ts'

async function main() {
  const url = process.env.DATABASE_MIGRATE_URL
    ?? 'postgres://vibesboard_migrate:vibesboard_migrate@localhost:5432/vibesboard_dev'
  const client = postgres(url, { max: 2, prepare: false })
  const db = drizzle(client, { schema })

  console.log('[seed] Seeding development data…')

  // Deterministic IDs so seeded data is referenceable from tests later.
  const TENANT = '11111111-1111-1111-1111-111111111111'
  const ADMIN = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const MEMBER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  const AGENT = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

  await db.insert(schema.users).values([
    { id: ADMIN,  email: 'admin@example.com',  name: 'Admin User',  isSuperAdmin: false },
    { id: MEMBER, email: 'member@example.com', name: 'Member User', isSuperAdmin: false },
  ]).onConflictDoNothing()

  await db.insert(schema.tenants).values({
    id: TENANT,
    name: 'Acme',
    slug: 'acme',
    createdBy: ADMIN,
  }).onConflictDoNothing()

  await db.insert(schema.tenantMembers).values([
    { tenantId: TENANT, userId: ADMIN,  role: 'TENANT_ADMIN' },
    { tenantId: TENANT, userId: MEMBER, role: 'MEMBER' },
  ]).onConflictDoNothing()

  await db.insert(schema.agents).values({
    id: AGENT,
    tenantId: TENANT,
    userId: ADMIN,
    name: 'Demo Agent',
    slug: 'demo-agent',
    instructions: 'You are a helpful demo agent.',
    mode: 'provider',
  }).onConflictDoNothing()

  const convId = uuidv7()
  await db.insert(schema.conversations).values({
    id: convId,
    tenantId: TENANT,
    agentId: AGENT,
    userId: ADMIN,
  }).onConflictDoNothing()

  await db.insert(schema.messages).values([
    { id: uuidv7(), tenantId: TENANT, conversationId: convId, role: 'user',      content: 'Hello!' },
    { id: uuidv7(), tenantId: TENANT, conversationId: convId, role: 'assistant', content: 'Hi there — how can I help?' },
    { id: uuidv7(), tenantId: TENANT, conversationId: convId, role: 'user',      content: 'Just testing the seed.' },
  ])

  console.log('[seed] Done.')
  await client.end({ timeout: 1 })
}

main().catch((err) => {
  console.error('[seed] Failed:', err)
  process.exit(1)
})
