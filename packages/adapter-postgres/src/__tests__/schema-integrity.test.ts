import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { withTestDb } from '../test-utils.ts'
import { tenants, agents, conversations, messages, files } from '../schema/index.ts'

describe('schema integrity', () => {
  test('deleting a tenant cascades to agents, conversations, messages, files', async () => {
    await withTestDb(async ({ adminDb, schemaName }) => {
      const tenantId = uuidv7()
      const agentId = uuidv7()
      const convId = uuidv7()
      await adminDb.transaction(async (tx: any) => {
        await tx.execute(sql.raw(`SET LOCAL search_path TO "${schemaName}", public`))
        await tx.insert(tenants).values({ id: tenantId, name: 'X', slug: 'x' })
        await tx.insert(agents).values({ id: agentId, tenantId, name: 'a', slug: 'a', mode: 'provider' })
        await tx.insert(conversations).values({ id: convId, tenantId, agentId })
        await tx.insert(messages).values({
          id: uuidv7(),
          tenantId,
          conversationId: convId,
          role: 'user',
          content: 'hi',
        })
        await tx.insert(files).values({
          id: uuidv7(),
          tenantId,
          agentId,
          fileKey: 'k',
          fileName: 'n',
          mimeType: 'text/plain',
          fileSize: 1,
        })
      })

      await adminDb.transaction(async (tx: any) => {
        await tx.execute(sql.raw(`SET LOCAL search_path TO "${schemaName}", public`))
        await tx.delete(tenants).where(eq(tenants.id, tenantId))
      })

      const [agentCount, convCount, msgCount, fileCount] = await adminDb.transaction(async (tx: any) => {
        await tx.execute(sql.raw(`SET LOCAL search_path TO "${schemaName}", public`))
        return Promise.all([
          tx.select().from(agents),
          tx.select().from(conversations),
          tx.select().from(messages),
          tx.select().from(files),
        ])
      })
      assert.equal(agentCount.length, 0)
      assert.equal(convCount.length, 0)
      assert.equal(msgCount.length, 0)
      assert.equal(fileCount.length, 0)
    })
  })

  test('unique (tenant_id, slug) on agents is enforced', async () => {
    await withTestDb(async ({ adminDb, schemaName }) => {
      const tenantId = uuidv7()
      await adminDb.transaction(async (tx: any) => {
        await tx.execute(sql.raw(`SET LOCAL search_path TO "${schemaName}", public`))
        await tx.insert(tenants).values({ id: tenantId, name: 'X', slug: 'x' })
        await tx.insert(agents).values({
          id: uuidv7(),
          tenantId,
          name: 'a',
          slug: 'dup',
          mode: 'provider',
        })
      })
      await assert.rejects(
        adminDb.transaction(async (tx: any) => {
          await tx.execute(sql.raw(`SET LOCAL search_path TO "${schemaName}", public`))
          await tx.insert(agents).values({
            id: uuidv7(),
            tenantId,
            name: 'b',
            slug: 'dup',
            mode: 'provider',
          })
        }),
        (err: any) => /unique|duplicate/i.test(err.cause?.message ?? err.message),
      )
    })
  })

  test('NOT NULL on tenants.slug is enforced', async () => {
    await withTestDb(async ({ adminDb, schemaName }) => {
      await assert.rejects(
        adminDb.transaction(async (tx: any) => {
          await tx.execute(sql.raw(`SET LOCAL search_path TO "${schemaName}", public`))
          await tx.insert(tenants).values({ id: uuidv7(), name: 'X', slug: null as any })
        }),
        (err: any) => /null value|violates not-null/i.test(err.cause?.message ?? err.message),
      )
    })
  })

  test('jsonb columns round-trip a nested object', async () => {
    await withTestDb(async ({ adminDb, schemaName }) => {
      const tenantId = uuidv7()
      const agentId = uuidv7()
      await adminDb.transaction(async (tx: any) => {
        await tx.execute(sql.raw(`SET LOCAL search_path TO "${schemaName}", public`))
        await tx.insert(tenants).values({ id: tenantId, name: 'X', slug: 'x' })
        await tx.insert(agents).values({
          id: agentId,
          tenantId,
          name: 'a',
          slug: 'a',
          mode: 'provider',
          notificationConfig: {
            enabled: true,
            events: ['completed', 'handoff'],
            inApp: { enabled: true },
            email: { enabled: false, address: null },
            webhook: { enabled: false, url: null, secret: null },
          },
        })
      })
      const [row] = await adminDb.transaction(async (tx: any) => {
        await tx.execute(sql.raw(`SET LOCAL search_path TO "${schemaName}", public`))
        return tx.select().from(agents).where(eq(agents.id, agentId))
      })
      assert.deepEqual(row.notificationConfig?.events, ['completed', 'handoff'])
      assert.equal(row.notificationConfig?.email.enabled, false)
    })
  })
})
