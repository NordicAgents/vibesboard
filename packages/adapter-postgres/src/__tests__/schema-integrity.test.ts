import { describe, it, expect } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { withTestDb } from '../test-utils.ts'
import {
  tenants,
  tenantMembers,
  users,
  agents,
  agentLinks,
  conversations,
  messages,
  files,
} from '../schema/index.ts'

// postgres-js (via drizzle) wraps the underlying Postgres error: the top-level
// `message` is "Failed query: …" and the real constraint/error text lives on
// `error.cause`. Flatten the whole chain so assertions match the actual DB
// error rather than the generic wrapper.
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

describe('schema integrity', () => {
  it('deleting a tenant cascades to agents, conversations, messages, files', async () => {
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

      const [agentCount, convCount, msgCount, fileCount] = await adminDb.transaction(
        async (tx: any) => {
          await tx.execute(sql.raw(`SET LOCAL search_path TO "${schemaName}", public`))
          return Promise.all([
            tx.select().from(agents),
            tx.select().from(conversations),
            tx.select().from(messages),
            tx.select().from(files),
          ])
        },
      )
      expect(agentCount.length).toBe(0)
      expect(convCount.length).toBe(0)
      expect(msgCount.length).toBe(0)
      expect(fileCount.length).toBe(0)
    })
  })

  it('unique (tenant_id, slug) on agents is enforced', async () => {
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
      await expectRejects(
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
        /unique|duplicate/i,
      )
    })
  })

  it('NOT NULL on tenants.slug is enforced', async () => {
    await withTestDb(async ({ adminDb, schemaName }) => {
      await expectRejects(
        adminDb.transaction(async (tx: any) => {
          await tx.execute(sql.raw(`SET LOCAL search_path TO "${schemaName}", public`))
          await tx.insert(tenants).values({ id: uuidv7(), name: 'X', slug: null as any })
        }),
        /null value|violates not-null|not-null/i,
      )
    })
  })

  it('jsonb columns round-trip a nested object', async () => {
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
          sourceUrls: ['https://theunseenhook.com'],
        })
      })
      const [row] = await adminDb.transaction(async (tx: any) => {
        await tx.execute(sql.raw(`SET LOCAL search_path TO "${schemaName}", public`))
        return tx.select().from(agents).where(eq(agents.id, agentId))
      })
      expect(row.notificationConfig?.events).toEqual(['completed', 'handoff'])
      expect(row.notificationConfig?.email.enabled).toBe(false)
      expect(row.sourceUrls).toEqual(['https://theunseenhook.com'])
    })
  })

  // ── Added coverage ─────────────────────────────────────────────────────

  it('rejects an agent referencing a non-existent tenant (FK violation)', async () => {
    await withTestDb(async ({ adminDb, schemaName }) => {
      await expectRejects(
        adminDb.transaction(async (tx: any) => {
          await tx.execute(sql.raw(`SET LOCAL search_path TO "${schemaName}", public`))
          await tx.insert(agents).values({
            id: uuidv7(),
            tenantId: uuidv7(), // no such tenant
            name: 'orphan',
            slug: 'orphan',
            mode: 'provider',
          })
        }),
        /foreign key|violates/i,
      )
    })
  })

  it('enforces unique user email', async () => {
    await withTestDb(async ({ adminDb, schemaName }) => {
      const email = `dup-${uuidv7().slice(0, 8)}@test.dev`
      await adminDb.transaction(async (tx: any) => {
        await tx.execute(sql.raw(`SET LOCAL search_path TO "${schemaName}", public`))
        await tx.insert(users).values({ id: uuidv7(), email })
      })
      await expectRejects(
        adminDb.transaction(async (tx: any) => {
          await tx.execute(sql.raw(`SET LOCAL search_path TO "${schemaName}", public`))
          await tx.insert(users).values({ id: uuidv7(), email })
        }),
        /unique|duplicate/i,
      )
    })
  })

  it('applies the default agent mode of "provider"', async () => {
    await withTestDb(async ({ adminDb, schemaName }) => {
      const tenantId = uuidv7()
      const agentId = uuidv7()
      await adminDb.transaction(async (tx: any) => {
        await tx.execute(sql.raw(`SET LOCAL search_path TO "${schemaName}", public`))
        await tx.insert(tenants).values({ id: tenantId, name: 'X', slug: 'x' })
        // Omit mode/instructions/allowAnonymous to exercise column defaults.
        await tx.insert(agents).values({ id: agentId, tenantId, name: 'a', slug: 'a' })
      })
      const [row] = await adminDb.transaction(async (tx: any) => {
        await tx.execute(sql.raw(`SET LOCAL search_path TO "${schemaName}", public`))
        return tx.select().from(agents).where(eq(agents.id, agentId))
      })
      expect(row.mode).toBe('provider')
      expect(row.instructions).toBe('')
      expect(row.allowAnonymous).toBe(false)
      expect(row.tools).toEqual([])
    })
  })

  it('tenant_members composite PK rejects a duplicate (tenant_id, user_id)', async () => {
    await withTestDb(async ({ adminDb, schemaName }) => {
      const tenantId = uuidv7()
      const userId = uuidv7()
      await adminDb.transaction(async (tx: any) => {
        await tx.execute(sql.raw(`SET LOCAL search_path TO "${schemaName}", public`))
        await tx.insert(tenants).values({ id: tenantId, name: 'X', slug: 'x' })
        await tx.insert(users).values({ id: userId, email: `u-${userId.slice(0, 8)}@t.dev` })
        await tx.insert(tenantMembers).values({ tenantId, userId, role: 'TENANT_ADMIN' })
      })
      await expectRejects(
        adminDb.transaction(async (tx: any) => {
          await tx.execute(sql.raw(`SET LOCAL search_path TO "${schemaName}", public`))
          await tx.insert(tenantMembers).values({ tenantId, userId, role: 'MEMBER' })
        }),
        /unique|duplicate|primary key/i,
      )
    })
  })

  it('deleting an agent cascade-deletes its agent_links', async () => {
    await withTestDb(async ({ adminDb, schemaName }) => {
      const tenantId = uuidv7()
      const agentId = uuidv7()
      const linkId = uuidv7()
      await adminDb.transaction(async (tx: any) => {
        await tx.execute(sql.raw(`SET LOCAL search_path TO "${schemaName}", public`))
        await tx.insert(tenants).values({ id: tenantId, name: 'X', slug: 'x' })
        await tx.insert(agents).values({ id: agentId, tenantId, name: 'a', slug: 'a', mode: 'provider' })
        await tx.insert(agentLinks).values({
          id: linkId,
          tenantId,
          agentId,
          slug: 'link',
          name: 'Link',
        })
        await tx.delete(agents).where(eq(agents.id, agentId))
      })
      const links = await adminDb.transaction(async (tx: any) => {
        await tx.execute(sql.raw(`SET LOCAL search_path TO "${schemaName}", public`))
        return tx.select().from(agentLinks).where(eq(agentLinks.id, linkId))
      })
      expect(links.length).toBe(0)
    })
  })

  it('messages cascade-delete when their conversation is removed', async () => {
    await withTestDb(async ({ adminDb, schemaName }) => {
      const tenantId = uuidv7()
      const agentId = uuidv7()
      const convId = uuidv7()
      const msgId = uuidv7()
      await adminDb.transaction(async (tx: any) => {
        await tx.execute(sql.raw(`SET LOCAL search_path TO "${schemaName}", public`))
        await tx.insert(tenants).values({ id: tenantId, name: 'X', slug: 'x' })
        await tx.insert(agents).values({ id: agentId, tenantId, name: 'a', slug: 'a', mode: 'provider' })
        await tx.insert(conversations).values({ id: convId, tenantId, agentId })
        await tx.insert(messages).values({
          id: msgId,
          tenantId,
          conversationId: convId,
          role: 'user',
          content: 'hi',
        })
        await tx.delete(conversations).where(eq(conversations.id, convId))
      })
      const msgs = await adminDb.transaction(async (tx: any) => {
        await tx.execute(sql.raw(`SET LOCAL search_path TO "${schemaName}", public`))
        return tx.select().from(messages).where(eq(messages.id, msgId))
      })
      expect(msgs.length).toBe(0)
    })
  })
})
