import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { withTestDb } from '../test-utils.ts'
import { tenants, embeddings } from '../schema/index.ts'

function randomVector(dim = 1536): number[] {
  return Array.from({ length: dim }, () => Math.random() * 2 - 1)
}

describe('vectors', () => {
  test('inserts 100 embeddings across two tenants and respects tenant scope', async () => {
    await withTestDb(async ({ adminDb }) => {
      const tA = uuidv7()
      const tB = uuidv7()
      await adminDb.insert(tenants).values([
        { id: tA, name: 'A', slug: 'a' },
        { id: tB, name: 'B', slug: 'b' },
      ])

      const rows = Array.from({ length: 100 }, (_, i) => ({
        id: uuidv7(),
        tenantId: i < 50 ? tA : tB,
        sourceType: 'file_chunk' as const,
        sourceId: uuidv7(),
        chunkIndex: i,
        content: `chunk ${i}`,
        embedding: randomVector(),
      }))
      await adminDb.insert(embeddings).values(rows)

      const aCount = await adminDb.execute<{ c: number }>(
        sql`SELECT count(*)::int AS c FROM embeddings WHERE tenant_id = ${tA}`,
      )
      const bCount = await adminDb.execute<{ c: number }>(
        sql`SELECT count(*)::int AS c FROM embeddings WHERE tenant_id = ${tB}`,
      )
      const aRows = aCount as unknown as Array<{ c: number }>
      const bRows = bCount as unknown as Array<{ c: number }>
      assert.equal(aRows[0].c, 50)
      assert.equal(bRows[0].c, 50)
    })
  })

  test('kNN query against pgvector returns ordered results', async () => {
    await withTestDb(async ({ adminDb }) => {
      const t = uuidv7()
      await adminDb.insert(tenants).values({ id: t, name: 'X', slug: 'x' })

      // Three vectors with known distances to a query vector
      const q = randomVector()
      const v1 = q.slice() // identical
      const v2 = q.map((x, i) => (i === 0 ? x + 0.1 : x))
      const v3 = q.map((x) => x + 1.0)

      await adminDb.insert(embeddings).values([
        { id: uuidv7(), tenantId: t, sourceType: 'file_chunk', sourceId: uuidv7(), chunkIndex: 0, content: 'v1', embedding: v1 },
        { id: uuidv7(), tenantId: t, sourceType: 'file_chunk', sourceId: uuidv7(), chunkIndex: 0, content: 'v2', embedding: v2 },
        { id: uuidv7(), tenantId: t, sourceType: 'file_chunk', sourceId: uuidv7(), chunkIndex: 0, content: 'v3', embedding: v3 },
      ])

      const qLiteral = `[${q.join(',')}]`
      const result = await adminDb.execute<{ content: string; distance: number }>(
        sql`SELECT content, embedding <=> ${qLiteral}::vector AS distance
            FROM embeddings
            WHERE tenant_id = ${t}
            ORDER BY embedding <=> ${qLiteral}::vector
            LIMIT 3`,
      )
      const rows = result as unknown as Array<{ content: string; distance: number }>
      assert.equal(rows.length, 3)
      assert.equal(rows[0].content, 'v1', 'identical vector ranks first')
      assert.equal(rows[2].content, 'v3', 'farthest vector ranks last')
    })
  })

  test('HNSW index exists on embeddings.embedding', async () => {
    await withTestDb(async ({ adminDb, schemaName }) => {
      // Just check the index exists in the test schema — proving the migration
      // created it. Postgres won't necessarily USE the HNSW index unless the
      // table has enough rows AND the planner thinks it'd be faster than seq
      // scan; for a fresh schema with no rows, EXPLAIN often picks seq scan.
      const result = await adminDb.execute<{ indexname: string }>(sql.raw(`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = '${schemaName}' AND tablename = 'embeddings'
        ORDER BY indexname
      `))
      const rows = result as unknown as Array<{ indexname: string }>
      const names = rows.map((r) => r.indexname)
      assert.ok(
        names.some((n) => n === 'embeddings_hnsw_idx'),
        `expected embeddings_hnsw_idx in ${names.join(', ')}`,
      )
    })
  })
})
