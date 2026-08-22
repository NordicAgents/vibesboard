import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { withTestDb } from '../test-utils.ts'

describe('migrations', () => {
  it('fresh schema applies every committed migration cleanly', async () => {
    await withTestDb(async ({ adminDb, schemaName }) => {
      // If we got here, all migrations ran. Sanity-check a few expected tables.
      const result = await adminDb.execute<{ relname: string }>(
        sql.raw(`
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname = '${schemaName}'
        ORDER BY c.relname
      `),
      )
      const tableNames = (
        result as unknown as Array<{ relname: string }>
      ).map((r) => r.relname)
      for (const name of [
        'tenants',
        'users',
        'agents',
        'conversations',
        'messages',
        'embeddings',
      ]) {
        expect(tableNames.includes(name)).toBeTruthy()
      }
    })
  })

  it('pgvector and pg_trgm extensions are available in the test database', async () => {
    await withTestDb(async ({ adminDb }) => {
      const result = await adminDb.execute<{ extname: string }>(
        sql.raw(`
        SELECT extname FROM pg_extension ORDER BY extname
      `),
      )
      const names = (
        result as unknown as Array<{ extname: string }>
      ).map((e) => e.extname)
      expect(names.includes('vector')).toBeTruthy()
      expect(names.includes('pg_trgm')).toBeTruthy()
    })
  })

  // ── Added coverage ─────────────────────────────────────────────────────

  it('creates the full set of expected application tables', async () => {
    await withTestDb(async ({ adminDb, schemaName }) => {
      const result = await adminDb.execute<{ relname: string }>(
        sql.raw(`
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname = '${schemaName}'
      `),
      )
      const names = new Set(
        (result as unknown as Array<{ relname: string }>).map((r) => r.relname),
      )
      // A representative cross-section spanning every migration / schema module.
      for (const expected of [
        'users',
        'sessions',
        'accounts',
        'verifications',
        'tenants',
        'tenant_members',
        'invitations',
        'agents',
        'agent_links',
        'hooks',
        'hook_jobs',
        'agent_invite_codes',
        'conversations',
        'messages',
        'conversation_feedback',
        'notifications',
        'files',
        'embeddings',
        'calendar_connections',
        'bookings',
        'booking_enquiries',
        'whatsapp_inbox_accounts',
        'feature_flags',
        'usage_counters',
        'data_connections',
        'tenant_branding',
      ]) {
        expect(names.has(expected)).toBeTruthy()
      }
    })
  })

  it('migrating into a fresh schema is independent per test (no leakage between schemas)', async () => {
    // Two independent withTestDb calls must each get an isolated, empty schema.
    const firstSchema = await withTestDb(async ({ adminDb, schemaName }) => {
      const rows = await adminDb.execute<{ c: number }>(
        sql.raw(`SELECT count(*)::int AS c FROM "${schemaName}".tenants`),
      )
      expect((rows as unknown as Array<{ c: number }>)[0].c).toBe(0)
      return schemaName
    })
    const secondSchema = await withTestDb(async ({ adminDb, schemaName }) => {
      const rows = await adminDb.execute<{ c: number }>(
        sql.raw(`SELECT count(*)::int AS c FROM "${schemaName}".tenants`),
      )
      expect((rows as unknown as Array<{ c: number }>)[0].c).toBe(0)
      return schemaName
    })
    expect(firstSchema).not.toBe(secondSchema)
  })

  it('core application tables expose audit timestamp columns', async () => {
    // Spot-check the audit convention on a representative set of tables that
    // are known to carry created_at (avoids coupling to every join/singleton
    // table, some of which intentionally track only updated_at/joined_at).
    await withTestDb(async ({ adminDb, schemaName }) => {
      const cols = (await adminDb.execute<{
        table_name: string
        column_name: string
      }>(
        sql.raw(`
          SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema = '${schemaName}' AND column_name = 'created_at'
        `),
      )) as unknown as Array<{ table_name: string; column_name: string }>
      const withCreatedAt = new Set(cols.map((c) => c.table_name))

      for (const t of [
        'users',
        'tenants',
        'agents',
        'conversations',
        'messages',
        'files',
        'embeddings',
      ]) {
        expect(withCreatedAt.has(t)).toBeTruthy()
      }
    })
  })
})
