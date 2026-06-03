/**
 * DB-backed persistence test for the inbox agent conversation lifecycle.
 *
 * handler.ts persists state through @vibesboard/agents/conversations
 * (ensureConversation / updateConversationMessages / isConversationHandedOff /
 * markConversationHandedOff). Each of those functions accepts an OPTIONAL `db`
 * as its last positional argument (defaulting to getMigrateDb(), which targets
 * the public schema). We use that db-injection seam to pass the withTestDb
 * adminDb (the isolated per-test schema) so the REAL agents conversation
 * data-access code runs end to end against an isolated schema.
 *
 * This validates the exact persistence contract handler.ts relies on:
 *  - a brand new inbox conversation is created (externalId = inbox:<...>)
 *  - assistant turns are appended via updateConversationMessages
 *  - handoff state round-trips through isConversationHandedOff /
 *    markConversationHandedOff
 *  - tenant scoping keys every read/write
 */
import { describe, it, expect } from 'vitest'

import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { seedTenantWithAgent } from '@vibesboard/test-helpers/factories'
import { conversations, messages } from '@vibesboard/adapter-postgres/schema'
import { and, eq } from 'drizzle-orm'
import type { Message } from '@vibesboard/contracts'

import {
  ensureConversation,
  updateConversationMessages,
  isConversationHandedOff,
  markConversationHandedOff
} from '@vibesboard/agents/conversations'

function userMsg(content: string): Message {
  return { id: crypto.randomUUID(), role: 'user', content }
}

describe('inbox conversation persistence (real agents data-access + withTestDb)', () => {
  it('creates a new agent conversation for an inbox externalId', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedTenantWithAgent(adminDb)
      const externalId = `inbox:whatsapp:acc-1:5511999`

      const convo = await ensureConversation(
        {
          tenantId,
          agentId,
          userId: null,
          externalId,
          initialMessages: [userMsg('Hello')]
        },
        adminDb
      )

      expect(convo.id).toBeTruthy()
      expect(convo.agentId).toBe(agentId)
      expect(convo.externalId).toBe(externalId)
      expect(convo.messages).toHaveLength(1)
      expect(convo.messages[0].content).toBe('Hello')

      const rows = await adminDb
        .select()
        .from(conversations)
        .where(eq(conversations.id, convo.id))
      expect(rows).toHaveLength(1)
      expect(rows[0].tenantId).toBe(tenantId)
      expect(rows[0].externalId).toBe(externalId)
      expect(rows[0].handedOff).toBe(false)
    })
  })

  it('is idempotent on externalId — a second ensure returns the same conversation', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedTenantWithAgent(adminDb)
      const externalId = `inbox:instagram:acc-1:igsid-1`

      const first = await ensureConversation(
        { tenantId, agentId, userId: null, externalId, initialMessages: [userMsg('one')] },
        adminDb
      )
      const second = await ensureConversation(
        { tenantId, agentId, userId: null, externalId, initialMessages: [userMsg('two')] },
        adminDb
      )

      expect(second.id).toBe(first.id)
      // Only one row exists for this externalId.
      const rows = await adminDb
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.tenantId, tenantId),
            eq(conversations.externalId, externalId)
          )
        )
      expect(rows).toHaveLength(1)
      // The existing conversation's messages are NOT overwritten by re-ensure.
      expect(second.messages[0].content).toBe('one')
    })
  })

  it('appends assistant turns through updateConversationMessages', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedTenantWithAgent(adminDb)
      const externalId = `inbox:whatsapp:acc-1:contact-x`

      const convo = await ensureConversation(
        { tenantId, agentId, userId: null, externalId, initialMessages: [userMsg('Hi')] },
        adminDb
      )

      const next: Message[] = [
        ...convo.messages,
        { id: crypto.randomUUID(), role: 'assistant', content: 'Hello, how can I help?' }
      ]
      await updateConversationMessages(
        { tenantId, agentId, conversationId: convo.id, messages: next },
        adminDb
      )

      // updateConversationMessages deletes + re-inserts every row in one
      // transaction, so all rows share a createdAt and the (createdAt, id)
      // ordering is not deterministic for our random ids. Assert on set
      // membership rather than position.
      const rows = await adminDb
        .select()
        .from(messages)
        .where(eq(messages.conversationId, convo.id))
      expect(rows).toHaveLength(2)
      const byRole = Object.fromEntries(rows.map((r: any) => [r.role, r.content]))
      expect(byRole.user).toBe('Hi')
      expect(byRole.assistant).toBe('Hello, how can I help?')
    })
  })

  it('round-trips handoff state', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedTenantWithAgent(adminDb)
      const externalId = `inbox:whatsapp:acc-1:handoff-contact`

      const convo = await ensureConversation(
        { tenantId, agentId, userId: null, externalId, initialMessages: [userMsg('escalate me')] },
        adminDb
      )

      // Fresh conversations are not handed off.
      expect(await isConversationHandedOff(tenantId, agentId, externalId, adminDb)).toBe(false)

      await markConversationHandedOff(tenantId, agentId, convo.id, adminDb)

      expect(await isConversationHandedOff(tenantId, agentId, externalId, adminDb)).toBe(true)

      const rows = await adminDb
        .select()
        .from(conversations)
        .where(eq(conversations.id, convo.id))
      expect(rows[0].handedOff).toBe(true)
    })
  })

  it('isConversationHandedOff returns false for an unknown externalId', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedTenantWithAgent(adminDb)
      const handed = await isConversationHandedOff(
        tenantId,
        agentId,
        'inbox:whatsapp:acc-1:never-seen',
        adminDb
      )
      expect(handed).toBe(false)
    })
  })

  it('scopes conversations per tenant — same externalId across tenants stays distinct', async () => {
    await withTestDb(async ({ adminDb }) => {
      const a = await seedTenantWithAgent(adminDb)
      const b = await seedTenantWithAgent(adminDb)
      const externalId = `inbox:whatsapp:shared-acc:shared-contact`

      const convoA = await ensureConversation(
        {
          tenantId: a.tenantId,
          agentId: a.agentId,
          userId: null,
          externalId,
          initialMessages: [userMsg('tenant a')]
        },
        adminDb
      )
      const convoB = await ensureConversation(
        {
          tenantId: b.tenantId,
          agentId: b.agentId,
          userId: null,
          externalId,
          initialMessages: [userMsg('tenant b')]
        },
        adminDb
      )

      expect(convoA.id).not.toBe(convoB.id)

      // Handing off tenant A's conversation must not affect tenant B's.
      await markConversationHandedOff(a.tenantId, a.agentId, convoA.id, adminDb)
      expect(await isConversationHandedOff(a.tenantId, a.agentId, externalId, adminDb)).toBe(true)
      expect(await isConversationHandedOff(b.tenantId, b.agentId, externalId, adminDb)).toBe(false)
    })
  })
})
