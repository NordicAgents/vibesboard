import { describe, it, expect } from 'vitest'
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
  updateConversationSummary,
  getConversationAnyAgent
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
  it('rowToConversation maps row + messages to VibeAgentConversation', () => {
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
    expect(conv.id).toBe('c1')
    expect(conv.createdAt).toBe('2026-05-24T00:00:00.000Z')
    expect(conv.messages.length).toBe(1)
    expect(conv.messages[0].content).toBe('hi')
    expect(conv.handedOff).toBe(false)
  })

  it('messageRowToMessage strips db-only fields', () => {
    const m = messageRowToMessage({
      id: 'm1',
      role: 'assistant',
      content: 'yo',
      createdAt: new Date()
    } as any)
    expect(Object.keys(m).sort()).toEqual(['content', 'id', 'role'])
  })
})

describe('ensureConversation / getConversation (pg)', () => {
  it('creates a conversation with initial messages and reads it back', async () => {
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
      expect(conv.id).toBeTruthy()
      expect(conv.messages.length).toBe(1)
      expect(conv.messages[0].content).toBe('hello')

      const fetched = await getConversation(tenantId, agentId, conv.id, adminDb)
      expect(fetched?.id).toBe(conv.id)
      expect(fetched?.messages[0].content).toBe('hello')
    })
  })

  it('ensureConversation returns existing by id (idempotent) and enforces agent ownership', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const first = await ensureConversation(
        { tenantId, agentId, externalId: 'ext-1' },
        adminDb
      )
      const again = await ensureConversation(
        {
          tenantId,
          agentId,
          conversationId: first.id,
          externalId: 'ext-1'
        },
        adminDb
      )
      expect(again.id).toBe(first.id)
    })
  })

  it('ensureConversation finds existing by externalId when no id given', async () => {
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
      expect(found.id).toBe(first.id)
    })
  })

  it('getConversation returns null for missing id', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      expect(
        await getConversation(tenantId, agentId, randomUUID(), adminDb)
      ).toBe(null)
    })
  })
})

describe('updateConversationMessages / listAgentConversations (pg)', () => {
  it('replaces the full message set (delete+reinsert) and preserves order', async () => {
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
      expect(after!.messages.map(m => m.content)).toEqual([
        'one',
        'two',
        'three'
      ])
      expect(after!.responseCounts?.[agentId]).toBe(1)
    })
  })

  it('listAgentConversations returns newest first, filters by externalId', async () => {
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
      const all = await listAgentConversations(
        tenantId,
        agentId,
        undefined,
        adminDb
      )
      expect(all.length).toBe(2)
      expect(all[0].id).toBe(a.id) // a was updated last → newest
      const filtered = await listAgentConversations(
        tenantId,
        agentId,
        { externalId: 'x2' },
        adminDb
      )
      expect(filtered.length).toBe(1)
      expect(filtered[0].id).toBe(b.id)
    })
  })
})

describe('handoff state (pg)', () => {
  it('mark / isHandedOff(byExternalId) / resume', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const conv = await ensureConversation(
        { tenantId, agentId, externalId: 'ext-h' },
        adminDb
      )
      expect(
        await isConversationHandedOff(tenantId, agentId, 'ext-h', adminDb)
      ).toBe(false)
      await markConversationHandedOff(tenantId, agentId, conv.id, adminDb)
      expect(
        await isConversationHandedOff(tenantId, agentId, 'ext-h', adminDb)
      ).toBe(true)
      await resumeConversation(tenantId, agentId, conv.id, adminDb)
      expect(
        await isConversationHandedOff(tenantId, agentId, 'ext-h', adminDb)
      ).toBe(false)
    })
  })
})

describe('handoff chain + derived refs (pg)', () => {
  it('recordConversationHandoff appends chain; target agent lists the conversation', async () => {
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

      const reloaded = await getConversation(
        tenantId,
        agentId,
        conv.id,
        adminDb
      )
      expect(reloaded!.handoffChain?.length).toBe(1)
      expect(reloaded!.handoffChain?.[0].toAgentId).toBe(targetId)

      const refs = await listHandoffConversationsForAgent(
        tenantId,
        targetId,
        adminDb
      )
      expect(refs.length).toBe(1)
      expect(refs[0].id).toBe(conv.id)
    })
  })
})

describe('deleteConversation (pg)', () => {
  it('deletes conversation and cascades messages; returns false when missing', async () => {
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
      expect(
        await deleteConversation(tenantId, agentId, conv.id, adminDb)
      ).toBe(true)
      expect(await getConversation(tenantId, agentId, conv.id, adminDb)).toBe(
        null
      )
      const remaining = await adminDb.select().from(messagesTbl)
      expect(
        remaining.filter((m: any) => m.conversationId === conv.id).length
      ).toBe(0)
      expect(
        await deleteConversation(tenantId, agentId, conv.id, adminDb)
      ).toBe(false)
    })
  })
})

describe('feedback (pg)', () => {
  it('records feedback; getConversation surfaces latest', async () => {
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
      const reloaded = await getConversation(
        tenantId,
        agentId,
        conv.id,
        adminDb
      )
      expect(reloaded!.feedback?.rating).toBe('positive')
      expect(reloaded!.feedback?.comment).toBe('great')
    })
  })
})

describe('close + refresh helpers (pg)', () => {
  it('closeConversation sets closedAt + summary', async () => {
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
      expect(res).toBe(true)
      const reloaded = await getConversation(
        tenantId,
        agentId,
        conv.id,
        adminDb
      )
      expect(reloaded!.closedAt).toBeTruthy()
      expect(reloaded!.summary).toBe('final summary')
    })
  })

  it('listUnsummarizedVisitorConversations returns visitor convos without summary', async () => {
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
      expect(rows.length).toBe(1)
      expect(rows[0].externalId).toBe('v1')
    })
  })

  it('updateConversationSummary sets summary without closing', async () => {
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
      const reloaded = await getConversation(
        tenantId,
        agentId,
        conv.id,
        adminDb
      )
      expect(reloaded!.summary).toBe('refreshed summary')
      expect(reloaded!.closedAt ?? null).toBe(null)
    })
  })
})

describe('ensureConversation ownership guards (pg)', () => {
  it('throws when an existing conversation does not belong to the agent', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, userId } = await seedAgent(adminDb)
      const otherAgentId = randomUUID()
      await adminDb.insert(agents).values({
        id: otherAgentId,
        tenantId,
        userId,
        name: 'Other',
        slug: `o-${otherAgentId.slice(0, 8)}`,
        instructions: 'ok ok ok'
      })
      const conv = await ensureConversation(
        { tenantId, agentId, externalId: 'ext-own' },
        adminDb
      )
      await expect(
        ensureConversation(
          { tenantId, agentId: otherAgentId, conversationId: conv.id },
          adminDb
        )
      ).rejects.toThrow(/does not belong to agent/)
    })
  })

  it('throws on unauthorized userId mismatch for an owned conversation', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, userId } = await seedAgent(adminDb)
      const conv = await ensureConversation(
        { tenantId, agentId, userId, initialMessages: [] },
        adminDb
      )
      await expect(
        ensureConversation(
          { tenantId, agentId, conversationId: conv.id, userId: randomUUID() },
          adminDb
        )
      ).rejects.toThrow(/Unauthorized conversation access/)
    })
  })

  it('throws on unauthorized externalId mismatch for an existing conversation', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const conv = await ensureConversation(
        { tenantId, agentId, externalId: 'ext-a' },
        adminDb
      )
      await expect(
        ensureConversation(
          { tenantId, agentId, conversationId: conv.id, externalId: 'ext-b' },
          adminDb
        )
      ).rejects.toThrow(/Unauthorized conversation access/)
    })
  })

  it('rejects an external visitor attaching to a user-bound conversation', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, userId } = await seedAgent(adminDb)
      const conv = await ensureConversation(
        { tenantId, agentId, userId, initialMessages: [] },
        adminDb
      )

      await expect(
        ensureConversation(
          {
            tenantId,
            agentId,
            conversationId: conv.id,
            externalId: 'public-visitor'
          },
          adminDb
        )
      ).rejects.toThrow(/Unauthorized conversation access/)
    })
  })

  it('rejects an authenticated user attaching to an external conversation', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, userId } = await seedAgent(adminDb)
      const conv = await ensureConversation(
        { tenantId, agentId, externalId: 'public-visitor' },
        adminDb
      )

      await expect(
        ensureConversation(
          { tenantId, agentId, conversationId: conv.id, userId },
          adminDb
        )
      ).rejects.toThrow(/Unauthorized conversation access/)
    })
  })
})

describe('conversation lifecycle edge cases (pg)', () => {
  it('updateConversationMessages accumulates responseCounts across calls', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const conv = await ensureConversation(
        { tenantId, agentId, externalId: 'rc' },
        adminDb
      )
      await updateConversationMessages(
        {
          tenantId,
          agentId,
          conversationId: conv.id,
          messages: [{ id: 'm1', role: 'assistant', content: 'a' }],
          respondingAgentId: agentId
        },
        adminDb
      )
      await updateConversationMessages(
        {
          tenantId,
          agentId,
          conversationId: conv.id,
          messages: [{ id: 'm2', role: 'assistant', content: 'b' }],
          respondingAgentId: agentId
        },
        adminDb
      )
      const after = await getConversation(tenantId, agentId, conv.id, adminDb)
      expect(after!.responseCounts?.[agentId]).toBe(2)
    })
  })

  it('updateConversationMessages persists an explicit summary patch', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const conv = await ensureConversation(
        { tenantId, agentId, externalId: 's' },
        adminDb
      )
      await updateConversationMessages(
        {
          tenantId,
          agentId,
          conversationId: conv.id,
          messages: [{ id: 'm1', role: 'user', content: 'q' }],
          summary: 'mid-summary'
        },
        adminDb
      )
      const after = await getConversation(tenantId, agentId, conv.id, adminDb)
      expect(after!.summary).toBe('mid-summary')
    })
  })

  it('closeConversation without a summary sets closedAt but leaves summary null', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const conv = await ensureConversation(
        { tenantId, agentId, externalId: 'c2' },
        adminDb
      )
      const ok = await closeConversation(
        tenantId,
        agentId,
        conv.id,
        null,
        adminDb
      )
      expect(ok).toBe(true)
      const after = await getConversation(tenantId, agentId, conv.id, adminDb)
      expect(after!.closedAt).toBeTruthy()
      expect(after!.summary).toBe(null)
    })
  })

  it('closeConversation returns false for an unknown conversation', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      expect(
        await closeConversation(tenantId, agentId, randomUUID(), 's', adminDb)
      ).toBe(false)
    })
  })

  it('recordConversationFeedback keeps the latest submission', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const conv = await ensureConversation(
        { tenantId, agentId, externalId: 'fb' },
        adminDb
      )
      await recordConversationFeedback(
        tenantId,
        conv.id,
        { rating: 'negative', comment: 'first' },
        adminDb
      )
      await recordConversationFeedback(
        tenantId,
        conv.id,
        { rating: 'positive', comment: 'second' },
        adminDb
      )
      const reloaded = await getConversation(
        tenantId,
        agentId,
        conv.id,
        adminDb
      )
      expect(reloaded!.feedback?.rating).toBe('positive')
      expect(reloaded!.feedback?.comment).toBe('second')
    })
  })

  it('recordConversationFeedback truncates long comments to 500 chars', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const conv = await ensureConversation(
        { tenantId, agentId, externalId: 'fbt' },
        adminDb
      )
      await recordConversationFeedback(
        tenantId,
        conv.id,
        { rating: 'positive', comment: 'x'.repeat(600) },
        adminDb
      )
      const reloaded = await getConversation(
        tenantId,
        agentId,
        conv.id,
        adminDb
      )
      expect(reloaded!.feedback?.comment?.length).toBe(500)
    })
  })

  it('getConversationAnyAgent loads a conversation regardless of agent filter', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const conv = await ensureConversation(
        { tenantId, agentId, externalId: 'any' },
        adminDb
      )
      const found = await getConversationAnyAgent(tenantId, conv.id, adminDb)
      expect(found?.id).toBe(conv.id)
      expect(
        await getConversationAnyAgent(tenantId, randomUUID(), adminDb)
      ).toBe(null)
    })
  })

  it('listAgentConversations filters by userId', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, userId } = await seedAgent(adminDb)
      await ensureConversation({ tenantId, agentId, userId }, adminDb)
      await ensureConversation(
        { tenantId, agentId, externalId: 'visitor' },
        adminDb
      )
      const mine = await listAgentConversations(
        tenantId,
        agentId,
        { userId },
        adminDb
      )
      expect(mine.length).toBe(1)
      expect(mine[0].userId).toBe(userId)
    })
  })
})

describe('conversation cross-tenant isolation (pg, regression)', () => {
  it("an agent's conversation from tenant A is not readable under tenant B's scope", async () => {
    await withTestDb(async ({ adminDb }) => {
      const a = await seedAgent(adminDb)
      const b = await seedAgent(adminDb)
      const conv = await ensureConversation(
        {
          tenantId: a.tenantId,
          agentId: a.agentId,
          externalId: 'secret',
          initialMessages: [{ id: 'm1', role: 'user', content: 'private' }]
        },
        adminDb
      )

      // Tenant B cannot read it by any of the scoped readers
      expect(
        await getConversation(b.tenantId, b.agentId, conv.id, adminDb)
      ).toBe(null)
      expect(await getConversationAnyAgent(b.tenantId, conv.id, adminDb)).toBe(
        null
      )
      expect(
        await listAgentConversations(b.tenantId, b.agentId, undefined, adminDb)
      ).toEqual([])
      expect(
        await isConversationHandedOff(b.tenantId, b.agentId, 'secret', adminDb)
      ).toBe(false)

      // Tenant B's scoped writes do not affect tenant A's conversation
      expect(
        await deleteConversation(b.tenantId, b.agentId, conv.id, adminDb)
      ).toBe(false)
      expect(
        await closeConversation(b.tenantId, b.agentId, conv.id, 'x', adminDb)
      ).toBe(false)

      // Tenant A still sees it intact
      const stillThere = await getConversation(
        a.tenantId,
        a.agentId,
        conv.id,
        adminDb
      )
      expect(stillThere?.messages[0].content).toBe('private')
      expect(stillThere?.closedAt ?? null).toBe(null)
    })
  })

  it('listHandoffConversationsForAgent does not surface another tenant handoff', async () => {
    await withTestDb(async ({ adminDb }) => {
      const a = await seedAgent(adminDb)
      const b = await seedAgent(adminDb)
      const targetId = randomUUID()
      await adminDb.insert(agents).values({
        id: targetId,
        tenantId: a.tenantId,
        userId: a.userId,
        name: 'T',
        slug: `t-${targetId.slice(0, 8)}`,
        instructions: 'ok ok ok'
      })
      const conv = await ensureConversation(
        { tenantId: a.tenantId, agentId: a.agentId, externalId: 'h' },
        adminDb
      )
      await recordConversationHandoff(
        a.tenantId,
        a.agentId,
        conv.id,
        {
          fromAgentId: a.agentId,
          fromAgentName: 'A',
          toAgentId: targetId,
          toAgentName: 'T'
        },
        adminDb
      )
      // Querying under tenant B for the same target id must return nothing
      expect(
        await listHandoffConversationsForAgent(b.tenantId, targetId, adminDb)
      ).toEqual([])
      // Tenant A still finds it
      const refs = await listHandoffConversationsForAgent(
        a.tenantId,
        targetId,
        adminDb
      )
      expect(refs.map(r => r.id)).toEqual([conv.id])
    })
  })
})
