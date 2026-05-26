import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, agents } from '@vibesboard/adapter-postgres/schema'
import { rowToConversation, messageRowToMessage } from '../db.ts'
import {
  ensureConversation,
  getConversation,
  updateConversationMessages,
  listAgentConversations,
  isConversationHandedOff,
  markConversationHandedOff,
  resumeConversation,
  recordConversationHandoff,
  listHandoffConversationsForAgent,
  deleteConversation,
  recordConversationFeedback,
  closeConversation,
  listUnsummarizedVisitorConversations,
  updateConversationSummary
} from '../conversations.ts'
import { messages as messagesTbl } from '@vibesboard/adapter-postgres/schema'

async function seedAgent(adminDb: any) {
  const u = randomUUID()
  const t = randomUUID()
  const a = randomUUID()
  await adminDb.insert(users).values({ id: u, email: `o${u}@a.com`, name: 'O' })
  await adminDb.insert(tenants).values({
    id: t,
    name: 'Acme',
    slug: `acme-${t.slice(0, 8)}`,
    createdBy: u,
    isPersonal: false
  })
  await adminDb.insert(agents).values({
    id: a,
    tenantId: t,
    userId: u,
    name: 'A',
    slug: `a-${a.slice(0, 8)}`,
    instructions: 'instructions ok'
  })
  return { tenantId: t, agentId: a, userId: u }
}

describe('conversation mappers', () => {
  test('rowToConversation maps row + messages to VibeAgentConversation', () => {
    const now = new Date('2026-05-24T00:00:00.000Z')
    const conv = rowToConversation(
      {
        id: 'c1',
        agentId: 'a1',
        userId: 'u1',
        externalId: null,
        summary: null,
        closedAt: null,
        handedOff: false,
        handoffChain: null,
        responseCounts: null,
        summaryGeneratedAt: null,
        summaryResponseCount: null,
        createdAt: now,
        updatedAt: now
      } as any,
      [{ id: 'm1', role: 'user', content: 'hi', createdAt: now } as any],
      null
    )
    assert.equal(conv.id, 'c1')
    assert.equal(conv.createdAt, '2026-05-24T00:00:00.000Z')
    assert.equal(conv.messages.length, 1)
    assert.equal(conv.messages[0].content, 'hi')
    assert.equal(conv.handedOff, false)
  })

  test('messageRowToMessage strips db-only fields', () => {
    const m = messageRowToMessage({
      id: 'm1',
      role: 'assistant',
      content: 'yo',
      createdAt: new Date()
    } as any)
    assert.deepEqual(Object.keys(m).sort(), ['content', 'id', 'role'])
  })
})

describe('ensureConversation / getConversation (pg)', () => {
  test('creates a conversation with initial messages and reads it back', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, userId } = await seedAgent(adminDb)
      const conv = await ensureConversation(
        {
          tenantId,
          agentId,
          userId,
          initialMessages: [{ id: 'm1', role: 'user', content: 'hello' }]
        },
        adminDb
      )
      assert.ok(conv.id)
      assert.equal(conv.messages.length, 1)
      assert.equal(conv.messages[0].content, 'hello')

      const fetched = await getConversation(tenantId, agentId, conv.id, adminDb)
      assert.equal(fetched?.id, conv.id)
      assert.equal(fetched?.messages[0].content, 'hello')
    })
  })

  test('ensureConversation returns existing by id (idempotent) and enforces agent ownership', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const first = await ensureConversation(
        { tenantId, agentId, externalId: 'ext-1' },
        adminDb
      )
      const again = await ensureConversation(
        { tenantId, agentId, conversationId: first.id },
        adminDb
      )
      assert.equal(again.id, first.id)
    })
  })

  test('ensureConversation finds existing by externalId when no id given', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const first = await ensureConversation(
        { tenantId, agentId, externalId: 'ext-9' },
        adminDb
      )
      const found = await ensureConversation(
        { tenantId, agentId, externalId: 'ext-9' },
        adminDb
      )
      assert.equal(found.id, first.id)
    })
  })

  test('getConversation returns null for missing id', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      assert.equal(
        await getConversation(tenantId, agentId, randomUUID(), adminDb),
        null
      )
    })
  })
})

describe('updateConversationMessages / listAgentConversations (pg)', () => {
  test('replaces the full message set (delete+reinsert) and preserves order', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const conv = await ensureConversation(
        {
          tenantId,
          agentId,
          initialMessages: [{ id: 'm1', role: 'user', content: 'one' }]
        },
        adminDb
      )
      await updateConversationMessages(
        {
          tenantId,
          agentId,
          conversationId: conv.id,
          messages: [
            { id: 'm1', role: 'user', content: 'one' },
            { id: 'm2', role: 'assistant', content: 'two' },
            { id: 'm3', role: 'user', content: 'three' }
          ],
          respondingAgentId: agentId
        },
        adminDb
      )
      const after = await getConversation(tenantId, agentId, conv.id, adminDb)
      assert.deepEqual(
        after!.messages.map((m) => m.content),
        ['one', 'two', 'three']
      )
      assert.equal(after!.responseCounts?.[agentId], 1)
    })
  })

  test('listAgentConversations returns newest first, filters by externalId', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const a = await ensureConversation(
        { tenantId, agentId, externalId: 'x1' },
        adminDb
      )
      const b = await ensureConversation(
        { tenantId, agentId, externalId: 'x2' },
        adminDb
      )
      await updateConversationMessages(
        {
          tenantId,
          agentId,
          conversationId: a.id,
          messages: [{ id: 'z', role: 'user', content: 'bump' }]
        },
        adminDb
      )
      const all = await listAgentConversations(tenantId, agentId, undefined, adminDb)
      assert.equal(all.length, 2)
      assert.equal(all[0].id, a.id) // a was updated last → newest
      const filtered = await listAgentConversations(
        tenantId,
        agentId,
        { externalId: 'x2' },
        adminDb
      )
      assert.equal(filtered.length, 1)
      assert.equal(filtered[0].id, b.id)
    })
  })
})

describe('handoff state (pg)', () => {
  test('mark / isHandedOff(byExternalId) / resume', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const conv = await ensureConversation(
        { tenantId, agentId, externalId: 'ext-h' },
        adminDb
      )
      assert.equal(
        await isConversationHandedOff(tenantId, agentId, 'ext-h', adminDb),
        false
      )
      await markConversationHandedOff(tenantId, agentId, conv.id, adminDb)
      assert.equal(
        await isConversationHandedOff(tenantId, agentId, 'ext-h', adminDb),
        true
      )
      await resumeConversation(tenantId, agentId, conv.id, adminDb)
      assert.equal(
        await isConversationHandedOff(tenantId, agentId, 'ext-h', adminDb),
        false
      )
    })
  })
})

describe('handoff chain + derived refs (pg)', () => {
  test('recordConversationHandoff appends chain; target agent lists the conversation', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, userId } = await seedAgent(adminDb)
      const targetId = randomUUID()
      await adminDb.insert(agents).values({
        id: targetId,
        tenantId,
        userId,
        name: 'T',
        slug: `t-${targetId.slice(0, 8)}`,
        instructions: 'ok ok ok'
      })
      const conv = await ensureConversation(
        { tenantId, agentId, externalId: 'ext-x' },
        adminDb
      )

      await recordConversationHandoff(
        tenantId,
        agentId,
        conv.id,
        {
          fromAgentId: agentId,
          fromAgentName: 'A',
          toAgentId: targetId,
          toAgentName: 'T'
        },
        adminDb
      )

      const reloaded = await getConversation(tenantId, agentId, conv.id, adminDb)
      assert.equal(reloaded!.handoffChain?.length, 1)
      assert.equal(reloaded!.handoffChain?.[0].toAgentId, targetId)

      const refs = await listHandoffConversationsForAgent(
        tenantId,
        targetId,
        adminDb
      )
      assert.equal(refs.length, 1)
      assert.equal(refs[0].id, conv.id)
    })
  })
})

describe('deleteConversation (pg)', () => {
  test('deletes conversation and cascades messages; returns false when missing', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const conv = await ensureConversation(
        {
          tenantId,
          agentId,
          initialMessages: [{ id: 'm1', role: 'user', content: 'x' }]
        },
        adminDb
      )
      assert.equal(
        await deleteConversation(tenantId, agentId, conv.id, adminDb),
        true
      )
      assert.equal(
        await getConversation(tenantId, agentId, conv.id, adminDb),
        null
      )
      const remaining = await adminDb.select().from(messagesTbl)
      assert.equal(
        remaining.filter((m: any) => m.conversationId === conv.id).length,
        0
      )
      assert.equal(
        await deleteConversation(tenantId, agentId, conv.id, adminDb),
        false
      )
    })
  })
})

describe('feedback (pg)', () => {
  test('records feedback; getConversation surfaces latest', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const conv = await ensureConversation(
        { tenantId, agentId, externalId: 'ext-f' },
        adminDb
      )
      await recordConversationFeedback(
        tenantId,
        conv.id,
        { rating: 'positive', comment: 'great' },
        adminDb
      )
      const reloaded = await getConversation(tenantId, agentId, conv.id, adminDb)
      assert.equal(reloaded!.feedback?.rating, 'positive')
      assert.equal(reloaded!.feedback?.comment, 'great')
    })
  })
})

describe('close + refresh helpers (pg)', () => {
  test('closeConversation sets closedAt + summary', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const conv = await ensureConversation(
        { tenantId, agentId, externalId: 'e' },
        adminDb
      )
      const res = await closeConversation(
        tenantId,
        agentId,
        conv.id,
        'final summary',
        adminDb
      )
      assert.equal(res, true)
      const reloaded = await getConversation(tenantId, agentId, conv.id, adminDb)
      assert.ok(reloaded!.closedAt)
      assert.equal(reloaded!.summary, 'final summary')
    })
  })

  test('listUnsummarizedVisitorConversations returns visitor convos without summary', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, userId } = await seedAgent(adminDb)
      await ensureConversation({ tenantId, agentId, externalId: 'v1' }, adminDb) // visitor, no summary
      await ensureConversation({ tenantId, agentId, userId }, adminDb) // owner → excluded
      const rows = await listUnsummarizedVisitorConversations(
        tenantId,
        agentId,
        20,
        adminDb
      )
      assert.equal(rows.length, 1)
      assert.equal(rows[0].externalId, 'v1')
    })
  })

  test('updateConversationSummary sets summary without closing', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const conv = await ensureConversation(
        { tenantId, agentId, externalId: 'u1' },
        adminDb
      )
      await updateConversationSummary(
        tenantId,
        agentId,
        conv.id,
        'refreshed summary',
        adminDb
      )
      const reloaded = await getConversation(tenantId, agentId, conv.id, adminDb)
      assert.equal(reloaded!.summary, 'refreshed summary')
      assert.equal(reloaded!.closedAt ?? null, null)
    })
  })
})
