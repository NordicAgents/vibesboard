import { describe, expect, it } from 'vitest'
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
  it('replaces conversation_chunk rows for the conversation', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, conversationId } = await seedConv(adminDb)
      const embed = async (texts: string[]) =>
        texts.map((_, i) => unitVec(768, i % 768))
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
        { db: adminDb, embed },
      )
      let rows = await adminDb
        .select()
        .from(embeddings)
        .where(
          and(
            eq(embeddings.sourceType, 'conversation_chunk'),
            eq(embeddings.sourceId, conversationId),
          ),
        )
      expect(rows.length).toBe(2)
      // re-run with fewer messages -> replaced, not appended
      await upsertConversationEmbeddings(
        {
          tenantId,
          agentId,
          conversationId,
          messages: [{ id: '1', role: 'user', content: 'only one' }],
        },
        { db: adminDb, embed },
      )
      rows = await adminDb
        .select()
        .from(embeddings)
        .where(
          and(
            eq(embeddings.sourceType, 'conversation_chunk'),
            eq(embeddings.sourceId, conversationId),
          ),
        )
      expect(rows.length).toBe(1)
      expect(rows[0].chunkIndex).toBe(0)
      expect(rows[0].content).toBe('only one')
    })
  })

  it('stores 768-dim embedding and content_tsv (keyword-searchable)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, conversationId } = await seedConv(adminDb)
      const embed = async (texts: string[]) => texts.map(() => unitVec(768, 7))
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
        { db: adminDb, embed },
      )
      // tsvector populated: keyword match returns exactly the fox row.
      const matched = await adminDb
        .select({ chunkIndex: embeddings.chunkIndex })
        .from(embeddings)
        .where(
          and(
            eq(embeddings.sourceType, 'conversation_chunk'),
            eq(embeddings.sourceId, conversationId),
            sql`${embeddings.contentTsv} @@ plainto_tsquery('english', 'fox')`,
          ),
        )
      expect(matched.length).toBe(1)
      expect(matched[0].chunkIndex).toBe(0)
    })
  })

  it('deleteConversationEmbeddings removes only that conversation chunks', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, conversationId } = await seedConv(adminDb)
      const embed = async (texts: string[]) => texts.map(() => unitVec(768, 1))
      await upsertConversationEmbeddings(
        {
          tenantId,
          agentId,
          conversationId,
          messages: [{ id: '1', role: 'user', content: 'keep me then delete' }],
        },
        { db: adminDb, embed },
      )
      await deleteConversationEmbeddings(tenantId, conversationId, adminDb)
      const rows = await adminDb
        .select()
        .from(embeddings)
        .where(eq(embeddings.sourceId, conversationId))
      expect(rows.length).toBe(0)
    })
  })
})

describe('buildAskAiConversationContext (pg)', () => {
  it('vector search surfaces the matching conversation window (cosine ordering)', async () => {
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
        adminDb,
      )
      const embed = async (texts: string[]) => texts.map(() => unitVec(768, 5))
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
        { db: adminDb, embed },
      )
      const res = await buildAskAiConversationContext(
        { tenantId, agentId, question: 'password reset?' },
        { db: adminDb, embed },
      )
      expect(res.usedVectorSearch).toBe(true)
      expect(res.context.includes('settings then security')).toBe(true)
      expect(res.sourceCount >= 1).toBe(true)
    })
  })

  it('only the nearest conversation ranks first across multiple conversations', async () => {
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
        adminDb,
      )
      await updateConversationMessages(
        {
          tenantId,
          agentId,
          conversationId: cFar,
          messages: [{ id: 'f1', role: 'assistant', content: 'FAR answer' }],
        },
        adminDb,
      )
      await upsertConversationEmbeddings(
        {
          tenantId,
          agentId,
          conversationId: cNear,
          messages: [{ id: 'n1', role: 'assistant', content: 'NEAR answer' }],
        },
        { db: adminDb, embed: async (t) => t.map(() => unitVec(768, 3)) },
      )
      await upsertConversationEmbeddings(
        {
          tenantId,
          agentId,
          conversationId: cFar,
          messages: [{ id: 'f1', role: 'assistant', content: 'FAR answer' }],
        },
        { db: adminDb, embed: async (t) => t.map(() => unitVec(768, 700)) },
      )
      // Query nearest to cNear (hot index 3).
      const res = await buildAskAiConversationContext(
        { tenantId, agentId, question: 'which?' },
        { db: adminDb, embed: async (t) => t.map(() => unitVec(768, 3)) },
      )
      expect(res.usedVectorSearch).toBe(true)
      const nearPos = res.context.indexOf('NEAR answer')
      const farPos = res.context.indexOf('FAR answer')
      expect(nearPos !== -1).toBe(true) // nearest conversation present
      if (farPos !== -1) expect(nearPos < farPos).toBe(true) // nearest ranked first
    })
  })

  it('falls back to recent visitor conversations when no embeddings exist', async () => {
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
        adminDb,
      )
      const embed = async (texts: string[]) => texts.map(() => unitVec(768, 5))
      const res = await buildAskAiConversationContext(
        { tenantId, agentId, question: 'when do you open' },
        { db: adminDb, embed },
      )
      expect(res.usedVectorSearch).toBe(false)
      expect(res.context.includes('we open at nine am')).toBe(true)
    })
  })
})

describe('setAgentEmbeddingsSyncedAt (pg)', () => {
  it('updates lastEmbeddingsSyncAt', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { agentId } = await seedConv(adminDb)
      const when = new Date('2026-05-24T12:00:00.000Z')
      await setAgentEmbeddingsSyncedAt(agentId, when, adminDb)
      const [row] = await adminDb
        .select()
        .from(agents)
        .where(eq(agents.id, agentId))
      expect(row.lastEmbeddingsSyncAt?.toISOString()).toBe(
        '2026-05-24T12:00:00.000Z',
      )
    })
  })
})
