import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { withTestDb } from '../test-utils.ts'

/**
 * Tables that are deliberately allowed to exist without RLS. Each entry must
 * be justified in a comment. Adding to this list is a security-reviewable
 * change.
 */
const RLS_EXEMPT = new Set<string>([
  // Drizzle Kit creates this to track applied migrations. Not application data.
  '__drizzle_migrations',
  // Better Auth verification tokens: identifier-keyed (the email being
  // verified), inserted BEFORE the user exists. The auth flow itself needs
  // to read/write by identifier without a user_id context. Stays public-readable.
  'verifications',
])

describe('rls coverage', () => {
  it('every public table has RLS enabled', async () => {
    await withTestDb(async ({ adminDb, schemaName }) => {
      const result = await adminDb.execute<{
        relname: string
        relrowsecurity: boolean
      }>(
        sql.raw(`
        SELECT c.relname, c.relrowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname = '${schemaName}'
      `),
      )
      const rows = result as unknown as Array<{
        relname: string
        relrowsecurity: boolean
      }>
      const missing = rows
        .filter((t) => !t.relrowsecurity && !RLS_EXEMPT.has(t.relname))
        .map((t) => t.relname)
      expect(missing).toEqual([])
    })
  })

  it('every public table has at least one RLS policy', async () => {
    await withTestDb(async ({ adminDb, schemaName }) => {
      const tablesResult = await adminDb.execute<{ relname: string }>(
        sql.raw(`
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname = '${schemaName}'
      `),
      )
      const tables = tablesResult as unknown as Array<{ relname: string }>
      const missingPolicy: string[] = []
      for (const { relname } of tables) {
        if (RLS_EXEMPT.has(relname)) continue
        const policies = await adminDb.execute<{ policyname: string }>(
          sql.raw(`
          SELECT policyname FROM pg_policies
          WHERE schemaname = '${schemaName}' AND tablename = '${relname}'
        `),
        )
        if ((policies as unknown as unknown[]).length === 0)
          missingPolicy.push(relname)
      }
      expect(missingPolicy).toEqual([])
    })
  })

  // ── Added coverage ─────────────────────────────────────────────────────

  it('the migrate (admin) role bypasses RLS', async () => {
    await withTestDb(async ({ adminDb }) => {
      const rows = (await adminDb.execute<{ rolbypassrls: boolean }>(
        sql`SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`,
      )) as unknown as Array<{ rolbypassrls: boolean }>
      expect(rows[0].rolbypassrls).toBe(true)
    })
  })

  it('the app role does NOT bypass RLS', async () => {
    await withTestDb(async ({ appDb }) => {
      const rows = (await appDb.execute<{ rolbypassrls: boolean }>(
        sql`SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`,
      )) as unknown as Array<{ rolbypassrls: boolean }>
      expect(rows[0].rolbypassrls).toBe(false)
    })
  })

  it('every tenant-scoped table policy references the app.current_tenant_id GUC', async () => {
    await withTestDb(async ({ adminDb, schemaName }) => {
      // Tables that carry tenant_id AND have RLS enabled must gate visibility
      // on the tenant GUC. Find them dynamically so a newly-added tenant table
      // without a tenant GUC reference fails this test.
      const tenantTables = (await adminDb.execute<{ table_name: string }>(
        sql.raw(`
          SELECT DISTINCT c.table_name
          FROM information_schema.columns c
          JOIN pg_class pc ON pc.relname = c.table_name
          JOIN pg_namespace n ON n.oid = pc.relnamespace AND n.nspname = c.table_schema
          WHERE c.table_schema = '${schemaName}'
            AND c.column_name = 'tenant_id'
            AND pc.relrowsecurity = true
        `),
      )) as unknown as Array<{ table_name: string }>

      expect(tenantTables.length).toBeGreaterThan(0)

      for (const { table_name } of tenantTables) {
        const policies = (await adminDb.execute<{
          policyname: string
          qual: string | null
          with_check: string | null
        }>(
          sql.raw(`
            SELECT policyname, qual, with_check FROM pg_policies
            WHERE schemaname = '${schemaName}' AND tablename = '${table_name}'
          `),
        )) as unknown as Array<{
          policyname: string
          qual: string | null
          with_check: string | null
        }>
        const referencesTenantGuc = policies.some((p) =>
          `${p.qual ?? ''} ${p.with_check ?? ''}`.includes(
            'app.current_tenant_id',
          ),
        )
        expect(
          referencesTenantGuc,
          `table ${table_name} has no policy referencing app.current_tenant_id`,
        ).toBe(true)
      }
    })
  })

  it('RLS policies honor the super-admin GUC for cross-tenant visibility', async () => {
    await withTestDb(async ({ adminDb, schemaName }) => {
      // rlsSetLocalSql sets app.is_super_admin, so at least some policy in the
      // schema must consult it to grant cross-tenant visibility. Search across
      // all policies (qual + with_check) rather than coupling to one table.
      const policies = (await adminDb.execute<{
        qual: string | null
        with_check: string | null
      }>(
        sql.raw(`
          SELECT qual, with_check FROM pg_policies
          WHERE schemaname = '${schemaName}'
        `),
      )) as unknown as Array<{ qual: string | null; with_check: string | null }>
      const referencesSuperAdmin = policies.some((p) =>
        `${p.qual ?? ''} ${p.with_check ?? ''}`.includes('is_super_admin'),
      )
      expect(referencesSuperAdmin).toBe(true)
    })
  })
})
