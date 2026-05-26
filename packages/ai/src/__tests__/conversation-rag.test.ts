import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import {
  users,
  tenants,
  agents,
  conversations,
  embeddings,
} from '@vibesboard/adapter-postgres/schema'
import { eq, and, sql } from 'drizzle-orm'
import {
  upsertConversationEmbeddings,
  deleteConversationEmbeddings,
} from '../embeddings.ts'
import { buildAskAiConversationContext } from '../conversation-rag.ts'
import { updateConversationMessages } from '@vibesboard/agents/conversations'
import { setAgentEmbeddingsSyncedAt } from '@vibesboard/agents/db'

function unitVec(dim: number, hot: number): number[] {
  const v = new Array(dim).fill(0)
  v[hot] = 1
  return v
}

async function seedConv(adminDb: any) {
  const u = randomUUID()
  const t = randomUUID()
  const a = randomUUID()
  const c = randomUUID()
  await adminDb.insert(users).values({ id: u, email: `o${u}@a.com`, name: 'O' })
  await adminDb.insert(tenants).values({
    id: t,
    name: 'Acme',
    slug: `acme-${t.slice(0, 8)}`,
    createdBy: u,
    isPersonal: false,
  })
  await adminDb.insert(agents).values({
    id: a,
    tenantId: t,
    userId: u,
    name: 'A',
    slug: `a-${a.slice(0, 8)}`,
    instructions: 'instructions ok',
  })
  await adminDb
    .insert(conversations)
    .values({ id: c, tenantId: t, agentId: a, externalId: 'visitor' })
  return { tenantId: t, agentId: a, conversationId: c, userId: u }
}

describe('upsertConversationEmbeddings (pg)', () => {
  test('replaces conversation_chunk rows for the conversation', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, conversationId } = await seedConv(adminDb)
      const embed = async (texts: string[]) =>
        texts.map((_, i) => unitVec(1536, i % 1536))
      await upsertConversationEmbeddings(
        {
          tenantId,
          agentId,
          conversationId,
          messages: [
            { id: '1', role: 'user', content: 'hello world' },
            { id: '2', role: 'assistant', content: 'hi there' },
          ],
        },
        { db: adminDb, embed }
      )
      let rows = await adminDb
        .select()
        .from(embeddings)
        .where(
          and(
            eq(embeddings.sourceType, 'conversation_chunk'),
            eq(embeddings.sourceId, conversationId)
          )
        )
      assert.equal(rows.length, 2)
      // re-run with fewer messages -> replaced, not appended
      await upsertConversationEmbeddings(
        {
          tenantId,
          agentId,
          conversationId,
          messages: [{ id: '1', role: 'user', content: 'only one' }],
        },
        { db: adminDb, embed }
      )
      rows = await adminDb
        .select()
        .from(embeddings)
        .where(
          and(
            eq(embeddings.sourceType, 'conversation_chunk'),
            eq(embeddings.sourceId, conversationId)
          )
        )
      assert.equal(rows.length, 1)
      assert.equal(rows[0].chunkIndex, 0)
      assert.equal(rows[0].content, 'only one')
    })
  })

  test('stores 1536-dim embedding and content_tsv (keyword-searchable)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, conversationId } = await seedConv(adminDb)
      const embed = async (texts: string[]) => texts.map(() => unitVec(1536, 7))
      await upsertConversationEmbeddings(
        {
          tenantId,
          agentId,
          conversationId,
          messages: [
            { id: '1', role: 'user', content: 'the quick brown fox' },
            { id: '2', role: 'assistant', content: 'lazy dogs sleeping' },
          ],
        },
        { db: adminDb, embed }
      )
      // tsvector populated: keyword match returns exactly the fox row.
      const matched = await adminDb
        .select({ chunkIndex: embeddings.chunkIndex })
        .from(embeddings)
        .where(
          and(
            eq(embeddings.sourceType, 'conversation_chunk'),
            eq(embeddings.sourceId, conversationId),
            sql`${embeddings.contentTsv} @@ plainto_tsquery('english', 'fox')`
          )
        )
      assert.equal(matched.length, 1)
      assert.equal(matched[0].chunkIndex, 0)
    })
  })

  test('deleteConversationEmbeddings removes only that conversation chunks', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, conversationId } = await seedConv(adminDb)
      const embed = async (texts: string[]) => texts.map(() => unitVec(1536, 1))
      await upsertConversationEmbeddings(
        {
          tenantId,
          agentId,
          conversationId,
          messages: [{ id: '1', role: 'user', content: 'keep me then delete' }],
        },
        { db: adminDb, embed }
      )
      await deleteConversationEmbeddings(tenantId, conversationId, adminDb)
      const rows = await adminDb
        .select()
        .from(embeddings)
        .where(eq(embeddings.sourceId, conversationId))
      assert.equal(rows.length, 0)
    })
  })
})

describe('buildAskAiConversationContext (pg)', () => {
  test('vector search surfaces the matching conversation window (cosine ordering)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, conversationId } = await seedConv(adminDb)
      await updateConversationMessages(
        {
          tenantId,
          agentId,
          conversationId,
          messages: [
            { id: '1', role: 'user', content: 'how do I reset my password' },
            {
              id: '2',
              role: 'assistant',
              content: 'go to settings then security',
            },
          ],
        },
        adminDb
      )
      const embed = async (texts: string[]) => texts.map(() => unitVec(1536, 5))
      await upsertConversationEmbeddings(
        {
          tenantId,
          agentId,
          conversationId,
          messages: [
            { id: '1', role: 'user', content: 'how do I reset my password' },
            {
              id: '2',
              role: 'assistant',
              content: 'go to settings then security',
            },
          ],
        },
        { db: adminDb, embed }
      )
      const res = await buildAskAiConversationContext(
        { tenantId, agentId, question: 'password reset?' },
        { db: adminDb, embed }
      )
      assert.equal(res.usedVectorSearch, true)
      assert.ok(res.context.includes('settings then security'))
      assert.ok(res.sourceCount >= 1)
    })
  })

  test('only the nearest conversation ranks first across multiple conversations', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedConv(adminDb)
      // Two more visitor conversations under the same agent.
      const cNear = randomUUID()
      const cFar = randomUUID()
      await adminDb.insert(conversations).values([
        { id: cNear, tenantId, agentId, externalId: 'near' },
        { id: cFar, tenantId, agentId, externalId: 'far' },
      ])
      await updateConversationMessages(
        {
          tenantId,
          agentId,
          conversationId: cNear,
          messages: [{ id: 'n1', role: 'assistant', content: 'NEAR answer' }],
        },
        adminDb
      )
      await updateConversationMessages(
        {
          tenantId,
          agentId,
          conversationId: cFar,
          messages: [{ id: 'f1', role: 'assistant', content: 'FAR answer' }],
        },
        adminDb
      )
      await upsertConversationEmbeddings(
        {
          tenantId,
          agentId,
          conversationId: cNear,
          messages: [{ id: 'n1', role: 'assistant', content: 'NEAR answer' }],
        },
        { db: adminDb, embed: async (t) => t.map(() => unitVec(1536, 3)) }
      )
      await upsertConversationEmbeddings(
        {
          tenantId,
          agentId,
          conversationId: cFar,
          messages: [{ id: 'f1', role: 'assistant', content: 'FAR answer' }],
        },
        { db: adminDb, embed: async (t) => t.map(() => unitVec(1536, 900)) }
      )
      // Query nearest to cNear (hot index 3).
      const res = await buildAskAiConversationContext(
        { tenantId, agentId, question: 'which?' },
        { db: adminDb, embed: async (t) => t.map(() => unitVec(1536, 3)) }
      )
      assert.equal(res.usedVectorSearch, true)
      const nearPos = res.context.indexOf('NEAR answer')
      const farPos = res.context.indexOf('FAR answer')
      assert.ok(nearPos !== -1, 'nearest conversation present')
      if (farPos !== -1) assert.ok(nearPos < farPos, 'nearest ranked first')
    })
  })

  test('falls back to recent visitor conversations when no embeddings exist', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, conversationId } = await seedConv(adminDb)
      await updateConversationMessages(
        {
          tenantId,
          agentId,
          conversationId,
          messages: [
            { id: '1', role: 'user', content: 'opening hours please' },
            { id: '2', role: 'assistant', content: 'we open at nine am' },
          ],
        },
        adminDb
      )
      const embed = async (texts: string[]) => texts.map(() => unitVec(1536, 5))
      const res = await buildAskAiConversationContext(
        { tenantId, agentId, question: 'when do you open' },
        { db: adminDb, embed }
      )
      assert.equal(res.usedVectorSearch, false)
      assert.ok(res.context.includes('we open at nine am'))
    })
  })
})

describe('setAgentEmbeddingsSyncedAt (pg)', () => {
  test('updates lastEmbeddingsSyncAt', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { agentId } = await seedConv(adminDb)
      const when = new Date('2026-05-24T12:00:00.000Z')
      await setAgentEmbeddingsSyncedAt(agentId, when, adminDb)
      const [row] = await adminDb
        .select()
        .from(agents)
        .where(eq(agents.id, agentId))
      assert.equal(
        row.lastEmbeddingsSyncAt?.toISOString(),
        '2026-05-24T12:00:00.000Z'
      )
    })
  })
})
