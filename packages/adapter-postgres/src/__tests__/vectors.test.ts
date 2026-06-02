import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { withTestDb } from '../test-utils.ts'
import { tenants, embeddings } from '../schema/index.ts'

function randomVector(dim = 1536): number[] {
  return Array.from({ length: dim }, () => Math.random() * 2 - 1)
}

// postgres-js wraps DB errors: the top-level message is "Failed query: …" and
// the real Postgres error text lives on `error.cause`. Flatten the chain.
function errorChain(err: unknown): string {
  const parts: string[] = []
  let cur: any = err
  let depth = 0
  while (cur && depth < 5) {
    if (typeof cur.message === 'string') parts.push(cur.message)
    if (typeof cur.detail === 'string') parts.push(cur.detail)
    if (typeof cur.code === 'string') parts.push(cur.code)
    cur = cur.cause
    depth++
  }
  return parts.join(' | ')
}

async function expectRejects(p: Promise<unknown>, re: RegExp): Promise<void> {
  let threw = false
  try {
    await p
  } catch (err) {
    threw = true
    expect(errorChain(err)).toMatch(re)
  }
  expect(threw).toBe(true)
}

describe('vectors', () => {
  it('inserts 100 embeddings across two tenants and respects tenant scope', async () => {
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
      expect(aRows[0].c).toBe(50)
      expect(bRows[0].c).toBe(50)
    })
  })

  it('kNN query against pgvector returns ordered results', async () => {
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
      expect(rows.length).toBe(3)
      expect(rows[0].content).toBe('v1')
      expect(rows[2].content).toBe('v3')
    })
  })

  it('HNSW index exists on embeddings.embedding', async () => {
    await withTestDb(async ({ adminDb, schemaName }) => {
      const result = await adminDb.execute<{ indexname: string }>(
        sql.raw(`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = '${schemaName}' AND tablename = 'embeddings'
        ORDER BY indexname
      `),
      )
      const rows = result as unknown as Array<{ indexname: string }>
      const names = rows.map((r) => r.indexname)
      expect(names.some((n) => n === 'embeddings_hnsw_idx')).toBeTruthy()
    })
  })

  // ── Added coverage ─────────────────────────────────────────────────────

  it('the vector extension is installed and exposes distance operators', async () => {
    await withTestDb(async ({ adminDb }) => {
      const ext = (await adminDb.execute<{ extname: string }>(
        sql`SELECT extname FROM pg_extension WHERE extname = 'vector'`,
      )) as unknown as Array<{ extname: string }>
      expect(ext.length).toBe(1)

      // Cosine, L2 and inner-product operators should all be usable on literals.
      const dist = (await adminDb.execute<{
        cos: number
        l2: number
        ip: number
      }>(
        sql`SELECT
          ('[1,0,0]'::vector <=> '[0,1,0]'::vector) AS cos,
          ('[1,0,0]'::vector <-> '[0,1,0]'::vector) AS l2,
          ('[1,0,0]'::vector <#> '[0,1,0]'::vector) AS ip`,
      )) as unknown as Array<{ cos: number; l2: number; ip: number }>
      expect(Number(dist[0].cos)).toBeGreaterThan(0)
      expect(Number(dist[0].l2)).toBeGreaterThan(0)
    })
  })

  it('rejects an embedding with the wrong number of dimensions', async () => {
    await withTestDb(async ({ adminDb, schemaName }) => {
      const t = uuidv7()
      await adminDb.insert(tenants).values({ id: t, name: 'Dim', slug: `d-${t.slice(0, 8)}` })
      await expectRejects(
        adminDb.execute(
          sql.raw(`
            INSERT INTO "${schemaName}".embeddings (id, tenant_id, source_type, source_id, chunk_index, content, embedding)
            VALUES ('${uuidv7()}', '${t}', 'file_chunk', '${uuidv7()}', 0, 'bad', '[1,2,3]'::vector)
          `),
        ),
        /dimension|expected 1536/i,
      )
    })
  })

  it('rejects a NULL embedding (column is NOT NULL)', async () => {
    await withTestDb(async ({ adminDb, schemaName }) => {
      const t = uuidv7()
      await adminDb.insert(tenants).values({ id: t, name: 'N', slug: `n-${t.slice(0, 8)}` })
      await expectRejects(
        adminDb.execute(
          sql.raw(`
            INSERT INTO "${schemaName}".embeddings (id, tenant_id, source_type, source_id, chunk_index, content)
            VALUES ('${uuidv7()}', '${t}', 'file_chunk', '${uuidv7()}', 0, 'no embedding')
          `),
        ),
        /not-null|null value/i,
      )
    })
  })

  it('embeddings are RLS-isolated per tenant for the app role', async () => {
    await withTestDb(async ({ adminDb, appDb, schemaName }) => {
      const tA = uuidv7()
      const tB = uuidv7()
      await adminDb.insert(tenants).values([
        { id: tA, name: 'A', slug: `a-${tA.slice(0, 8)}` },
        { id: tB, name: 'B', slug: `b-${tB.slice(0, 8)}` },
      ])
      await adminDb.insert(embeddings).values([
        { id: uuidv7(), tenantId: tA, sourceType: 'file_chunk', sourceId: uuidv7(), chunkIndex: 0, content: 'a', embedding: randomVector() },
        { id: uuidv7(), tenantId: tB, sourceType: 'file_chunk', sourceId: uuidv7(), chunkIndex: 0, content: 'b', embedding: randomVector() },
      ])
      const rows = await appDb.transaction(async (tx) => {
        await tx.execute(sql.raw(`SET search_path TO "${schemaName}", public`))
        await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tA}, true)`)
        await tx.execute(sql`SELECT set_config('app.current_user_id', '', true)`)
        await tx.execute(sql`SELECT set_config('app.is_super_admin', 'false', true)`)
        return tx.select().from(embeddings)
      })
      expect(rows.map((r) => r.content)).toEqual(['a'])
    })
  })
})
