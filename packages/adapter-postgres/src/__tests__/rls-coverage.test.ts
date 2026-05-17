import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
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
])

describe('rls coverage', () => {
  test('every public table has RLS enabled', async () => {
    await withTestDb(async ({ adminDb, schemaName }) => {
      const result = await adminDb.execute<{ relname: string; relrowsecurity: boolean }>(sql.raw(`
        SELECT c.relname, c.relrowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname = '${schemaName}'
      `))
      const rows = result as unknown as Array<{ relname: string; relrowsecurity: boolean }>
      const missing = rows
        .filter((t) => !t.relrowsecurity && !RLS_EXEMPT.has(t.relname))
        .map((t) => t.relname)
      assert.deepEqual(missing, [], `tables without RLS: ${missing.join(', ')}`)
    })
  })

  test('every public table has at least one RLS policy', async () => {
    await withTestDb(async ({ adminDb, schemaName }) => {
      const tablesResult = await adminDb.execute<{ relname: string }>(sql.raw(`
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname = '${schemaName}'
      `))
      const tables = tablesResult as unknown as Array<{ relname: string }>
      const missingPolicy: string[] = []
      for (const { relname } of tables) {
        if (RLS_EXEMPT.has(relname)) continue
        const policies = await adminDb.execute<{ policyname: string }>(sql.raw(`
          SELECT policyname FROM pg_policies
          WHERE schemaname = '${schemaName}' AND tablename = '${relname}'
        `))
        if ((policies as unknown as unknown[]).length === 0) missingPolicy.push(relname)
      }
      assert.deepEqual(missingPolicy, [], `tables without policies: ${missingPolicy.join(', ')}`)
    })
  })
})
