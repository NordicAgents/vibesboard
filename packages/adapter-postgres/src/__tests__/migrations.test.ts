import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'
import { withTestDb } from '../test-utils.ts'

describe('migrations', () => {
  test('fresh schema applies every committed migration cleanly', async () => {
    await withTestDb(async ({ adminDb, schemaName }) => {
      // If we got here, all migrations ran. Sanity-check a few expected tables.
      const result = await adminDb.execute<{ relname: string }>(sql.raw(`
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname = '${schemaName}'
        ORDER BY c.relname
      `))
      const tableNames = (result as unknown as Array<{ relname: string }>).map((r) => r.relname)
      for (const name of ['tenants', 'users', 'agents', 'conversations', 'messages', 'embeddings']) {
        assert.ok(tableNames.includes(name), `expected table ${name} after migrations`)
      }
    })
  })

  test('pgvector and pg_trgm extensions are available in the test database', async () => {
    await withTestDb(async ({ adminDb }) => {
      const result = await adminDb.execute<{ extname: string }>(sql.raw(`
        SELECT extname FROM pg_extension ORDER BY extname
      `))
      const names = (result as unknown as Array<{ extname: string }>).map((e) => e.extname)
      assert.ok(names.includes('vector'), 'vector extension missing')
      assert.ok(names.includes('pg_trgm'), 'pg_trgm extension missing')
    })
  })
})
