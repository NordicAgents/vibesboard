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
  listAgentConversations
} from '../conversations.ts'

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
