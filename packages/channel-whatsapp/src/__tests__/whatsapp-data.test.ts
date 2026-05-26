import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants } from '@vibesboard/adapter-postgres/schema'
import {
  rowToWhatsappAccount,
  rowToWhatsappConversation,
  rowToWhatsappMessage,
} from '../db.ts'
import { eq } from 'drizzle-orm'
import { whatsappAccounts } from '@vibesboard/adapter-postgres/schema'
import {
  listInboxAccounts,
  getInboxAccount,
  disconnectInboxAccount,
  findAccountByWabaId,
  updateAccountAssignment,
  createAccountRow,
} from '../accounts.ts'
import {
  getOrCreateConversation,
  listConversations,
  getConversation as getWaConversation,
  updateConversationStatus,
  assignConversation,
  markAsRead,
  updateConversationAgentSettings,
  setConversationHandoff,
  linkAgentConversation,
} from '../conversations.ts'
import { agents, conversations } from '@vibesboard/adapter-postgres/schema'
import {
  listMessages,
  updateMessageStatus,
  persistInboundMessage,
  persistOutboundMessage,
} from '../messages.ts'
import {
  whatsappMessages,
  whatsappConversations as waConvTbl,
} from '@vibesboard/adapter-postgres/schema'

async function seedAccount(adminDb: any) {
  const { tenantId, userId } = await seedTenant(adminDb)
  const id = randomUUID()
  await adminDb.insert(whatsappAccounts).values({
    id,
    tenantId,
    wabaId: 'w',
    phoneNumberId: 'p',
    displayPhoneNumber: '+1',
    businessName: 'B',
    accessTokenEncrypted: 'e',
    scopes: [],
    connectedBy: userId,
    webhookSubscribed: true,
  })
  return { tenantId, accountId: id, userId }
}

async function seedTenant(adminDb: any) {
  const u = randomUUID()
  const t = randomUUID()
  await adminDb.insert(users).values({ id: u, email: `o${u}@a.com`, name: 'O' })
  await adminDb.insert(tenants).values({
    id: t,
    name: 'Acme',
    slug: `acme-${t.slice(0, 8)}`,
    createdBy: u,
    isPersonal: false,
  })
  return { tenantId: t, userId: u }
}

describe('whatsapp mappers', () => {
  test('rowToWhatsappAccount maps row to legacy doc shape', () => {
    const now = new Date('2026-05-25T00:00:00.000Z')
    const acc = rowToWhatsappAccount({
      id: 'a1',
      tenantId: 't1',
      wabaId: 'w1',
      phoneNumberId: 'p1',
      displayPhoneNumber: '+1',
      businessName: 'Biz',
      accessTokenEncrypted: 'enc',
      scopes: ['s'],
      status: 'active',
      connectedBy: 'u1',
      connectedAt: now,
      webhookSubscribed: true,
      connectionMethod: 'oauth',
      metaAppId: null,
      metaAppSecretEncrypted: null,
      webhookVerifyTokenEncrypted: null,
      byoaWebhookUrl: null,
      assignedAgentId: null,
      agentAutoReply: false,
      createdAt: now,
      updatedAt: now,
    } as never)
    assert.equal(acc.id, 'a1')
    assert.equal(acc.accessToken, 'enc')
    assert.equal(acc.connectedAt, '2026-05-25T00:00:00.000Z')
    assert.equal(acc.agentAutoReply, false)
  })

  test('rowToWhatsappConversation maps id + window', () => {
    const now = new Date('2026-05-25T00:00:00.000Z')
    const c = rowToWhatsappConversation({
      id: 'c1',
      tenantId: 't1',
      accountId: 'a1',
      contactPhone: '15551234',
      contactName: null,
      contactProfileName: null,
      lastMessageAt: now,
      lastMessagePreview: 'hi',
      unreadCount: 2,
      assignedTo: null,
      assignedAgentId: null,
      agentPaused: false,
      agentHandedOff: false,
      agentConversationId: null,
      status: 'open',
      windowExpiresAt: now,
      createdAt: now,
      updatedAt: now,
    } as never)
    assert.equal(c.id, 'c1')
    assert.equal(c.contactPhone, '15551234')
    assert.equal(c.unreadCount, 2)
    assert.equal(c.windowExpiresAt, '2026-05-25T00:00:00.000Z')
  })

  test('rowToWhatsappMessage maps type/direction/status', () => {
    const now = new Date('2026-05-25T00:00:00.000Z')
    const m = rowToWhatsappMessage({
      id: 'm1',
      tenantId: 't1',
      conversationId: 'c1',
      waMessageId: 'wamid.1',
      fromAddr: '15551234',
      toAddr: 'p1',
      type: 'text',
      text: 'hi',
      mediaUrl: null,
      caption: null,
      direction: 'inbound',
      status: 'received',
      sentBy: null,
      sentByAgentName: null,
      timestampOriginal: now,
      createdAt: now,
    } as never)
    assert.equal(m.waMessageId, 'wamid.1')
    assert.equal(m.from, '15551234')
    assert.equal(m.to, 'p1')
    assert.equal(m.timestamp, '2026-05-25T00:00:00.000Z')
    assert.equal(m.direction, 'inbound')
  })
})

describe('whatsapp accounts (pg)', () => {
  test('create / list / get / disconnect / findByWaba / assignment', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, userId } = await seedTenant(adminDb)
      const created = await createAccountRow(
        {
          tenantId,
          wabaId: 'waba-1',
          phoneNumberId: 'pn-1',
          displayPhoneNumber: '+1',
          businessName: 'Biz',
          accessTokenEncrypted: 'enc',
          connectedBy: userId,
          connectionMethod: 'api_key',
          webhookSubscribed: true,
          scopes: ['whatsapp_business_messaging'],
        },
        adminDb,
      )
      assert.ok(created.id)

      const list = await listInboxAccounts(tenantId, adminDb)
      assert.equal(list.length, 1)

      const got = await getInboxAccount(tenantId, created.id, adminDb)
      assert.equal(got?.wabaId, 'waba-1')

      const found = await findAccountByWabaId('waba-1', adminDb)
      assert.equal(found?.tenantId, tenantId)

      await updateAccountAssignment(
        tenantId,
        created.id,
        { assignedAgentId: null, agentAutoReply: true },
        adminDb,
      )
      const after = await getInboxAccount(tenantId, created.id, adminDb)
      assert.equal(after?.agentAutoReply, true)

      await disconnectInboxAccount(tenantId, created.id, adminDb)
      const disc = await getInboxAccount(tenantId, created.id, adminDb)
      assert.equal(disc?.status, 'disconnected')
      assert.equal(await findAccountByWabaId('waba-1', adminDb), null) // only active
    })
  })
})

describe('whatsapp conversations (pg)', () => {
  test('getOrCreate is idempotent on (account, contactPhone)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, accountId } = await seedAccount(adminDb)
      const a = await getOrCreateConversation(
        tenantId,
        accountId,
        '+1 (555) 123-4',
        'Alice',
        adminDb,
      )
      const b = await getOrCreateConversation(
        tenantId,
        accountId,
        '15551234',
        undefined,
        adminDb,
      )
      assert.equal(a.id, b.id) // same row — phone normalized to digits
      assert.equal(a.contactPhone, '15551234')
    })
  })

  test('list / get / status / assign / markAsRead / agentSettings', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, accountId } = await seedAccount(adminDb)
      await getOrCreateConversation(tenantId, accountId, '15551234', 'Alice', adminDb)
      const list = await listConversations(tenantId, accountId, undefined, adminDb)
      assert.equal(list.length, 1)
      const c = await getWaConversation(tenantId, accountId, '15551234', adminDb)
      assert.equal(c?.contactName, 'Alice')
      await updateConversationStatus(tenantId, accountId, '15551234', 'resolved', adminDb)
      await assignConversation(tenantId, accountId, '15551234', null, adminDb)
      await markAsRead(tenantId, accountId, '15551234', adminDb)
      await updateConversationAgentSettings(
        tenantId,
        accountId,
        '15551234',
        { agentPaused: true },
        adminDb,
      )
      const c2 = await getWaConversation(tenantId, accountId, '15551234', adminDb)
      assert.equal(c2?.status, 'resolved')
      assert.equal(c2?.unreadCount, 0)
      assert.equal(c2?.agentPaused, true)
    })
  })
})

describe('whatsapp messages (pg)', () => {
  test('insert inbound updates conversation; list chronological; status monotonic', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, accountId } = await seedAccount(adminDb)
      const convo = await getOrCreateConversation(
        tenantId,
        accountId,
        '15551234',
        'Alice',
        adminDb,
      )
      await persistInboundMessage(
        {
          tenantId,
          accountId,
          conversationId: convo.id,
          contactPhone: '15551234',
          phoneNumberId: 'p',
          waMessageId: 'wamid.in.1',
          type: 'text',
          text: 'hi',
          timestampOriginal: new Date('2026-05-25T01:00:00Z'),
          contactName: 'Alice',
        },
        adminDb,
      )
      const msgs = await listMessages(
        tenantId,
        accountId,
        '15551234',
        50,
        undefined,
        adminDb,
      )
      assert.equal(msgs.length, 1)
      assert.equal(msgs[0].text, 'hi')
      const [c] = await adminDb
        .select()
        .from(waConvTbl)
        .where(eq(waConvTbl.id, convo.id))
      assert.equal(c.unreadCount, 1)
      assert.equal(c.lastMessagePreview, 'hi')

      await persistOutboundMessage(
        {
          tenantId,
          accountId,
          conversationId: convo.id,
          contactPhone: '15551234',
          waMessageId: 'wamid.out.1',
          from: '+1',
          text: 'hello',
          timestampOriginal: new Date(),
        },
        adminDb,
      )
      await updateMessageStatus('wamid.out.1', 'delivered', undefined, adminDb)
      await updateMessageStatus('wamid.out.1', 'sent', undefined, adminDb) // ignored (backwards)
      const [m] = await adminDb
        .select()
        .from(whatsappMessages)
        .where(eq(whatsappMessages.waMessageId, 'wamid.out.1'))
      assert.equal(m.status, 'delivered')
    })
  })
})

describe('whatsapp handoff + link (pg)', () => {
  test('setConversationHandoff + linkAgentConversation by id', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, accountId } = await seedAccount(adminDb)
      const convo = await getOrCreateConversation(
        tenantId,
        accountId,
        '15551234',
        'Alice',
        adminDb,
      )
      // Seed a real agent + core conversation so agent_conversation_id FK resolves.
      const agentId = randomUUID()
      const acid = randomUUID()
      await adminDb
        .insert(agents)
        .values({ id: agentId, tenantId, name: 'A', slug: `a-${agentId.slice(0, 8)}` })
      await adminDb
        .insert(conversations)
        .values({ id: acid, tenantId, agentId })

      await setConversationHandoff(tenantId, convo.id, true, adminDb)
      await linkAgentConversation(tenantId, convo.id, acid, adminDb)

      const [row] = await adminDb
        .select()
        .from(waConvTbl)
        .where(eq(waConvTbl.id, convo.id))
      assert.equal(row.agentHandedOff, true)
      assert.equal(row.agentConversationId, acid)
    })
  })
})
