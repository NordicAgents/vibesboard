import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants } from '@vibesboard/adapter-postgres/schema'
import {
  rowToInstagramAccount,
  rowToInstagramConversation,
  rowToInstagramMessage,
} from '../db.ts'
import { eq } from 'drizzle-orm'
import {
  instagramAccounts,
  instagramMessages,
  instagramConversations as igConvTbl,
} from '@vibesboard/adapter-postgres/schema'
import {
  createAccountRow,
  listInboxAccounts,
  getInboxAccount,
  disconnectInboxAccount,
  findAccountByPageId,
  updateAccountAssignment,
  deleteInboxAccount,
} from '../accounts.ts'
import {
  getOrCreateConversation,
  listConversations,
  getConversation as getIgConversation,
  updateConversationStatus,
  assignConversation,
  markAsRead,
  updateConversationAgentSettings,
} from '../conversations.ts'
import {
  listMessages,
  updateMessageStatus,
  persistInboundMessage,
  persistOutboundMessage,
} from '../messages.ts'

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

async function seedAccount(adminDb: any) {
  const { tenantId, userId } = await seedTenant(adminDb)
  const id = randomUUID()
  await adminDb.insert(instagramAccounts).values({
    id,
    tenantId,
    instagramAccountId: 'ig',
    pageId: 'p',
    pageName: 'P',
    instagramUsername: 'u',
    accessTokenEncrypted: 'e',
    scopes: [],
    connectedBy: userId,
    webhookSubscribed: true,
  })
  return { tenantId, accountId: id, userId }
}

describe('instagram mappers', () => {
  test('rowToInstagramAccount maps row to legacy doc shape', () => {
    const now = new Date('2026-05-25T00:00:00.000Z')
    const acc = rowToInstagramAccount({
      id: 'a1',
      tenantId: 't1',
      instagramAccountId: 'ig1',
      pageId: 'page1',
      pageName: 'Page',
      instagramUsername: 'biz',
      accessTokenEncrypted: 'enc',
      scopes: ['s'],
      status: 'active',
      connectedBy: 'u1',
      connectedAt: now,
      webhookSubscribed: true,
      metaUserId: null,
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
    assert.equal(acc.instagramAccountId, 'ig1')
    assert.equal(acc.pageId, 'page1')
    assert.equal(acc.accessToken, 'enc')
    assert.equal(acc.connectedAt, '2026-05-25T00:00:00.000Z')
    assert.equal(acc.agentAutoReply, false)
  })

  test('rowToInstagramConversation maps contactIgsid + window', () => {
    const now = new Date('2026-05-25T00:00:00.000Z')
    const c = rowToInstagramConversation({
      id: 'c1',
      tenantId: 't1',
      accountId: 'a1',
      contactIgsid: '178414',
      contactName: null,
      contactUsername: 'bob',
      contactProfilePic: null,
      lastMessageAt: now,
      lastMessagePreview: 'yo',
      unreadCount: 1,
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
    assert.equal(c.contactIgsid, '178414')
    assert.equal(c.contactUsername, 'bob')
    assert.equal(c.windowExpiresAt, '2026-05-25T00:00:00.000Z')
  })

  test('rowToInstagramMessage maps igMessageId', () => {
    const now = new Date('2026-05-25T00:00:00.000Z')
    const m = rowToInstagramMessage({
      id: 'm1',
      tenantId: 't1',
      conversationId: 'c1',
      igMessageId: 'mid.1',
      fromAddr: '178414',
      toAddr: 'page1',
      type: 'text',
      text: 'yo',
      mediaUrl: null,
      caption: null,
      direction: 'inbound',
      status: 'received',
      sentBy: null,
      sentByAgentName: null,
      timestampOriginal: now,
      createdAt: now,
    } as never)
    assert.equal(m.igMessageId, 'mid.1')
    assert.equal(m.from, '178414')
    assert.equal(m.timestamp, '2026-05-25T00:00:00.000Z')
  })
})

describe('instagram accounts (pg)', () => {
  test('create / list / get / findByPage / assign / disconnect / delete', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, userId } = await seedTenant(adminDb)
      const created = await createAccountRow(
        {
          tenantId,
          instagramAccountId: 'ig-1',
          pageId: 'page-1',
          pageName: 'Page',
          instagramUsername: 'biz',
          accessTokenEncrypted: 'enc',
          connectedBy: userId,
          connectionMethod: 'api_key',
          webhookSubscribed: true,
          scopes: ['instagram_basic'],
        },
        adminDb,
      )
      assert.ok(created.id)
      assert.equal((await listInboxAccounts(tenantId, adminDb)).length, 1)
      assert.equal(
        (await getInboxAccount(tenantId, created.id, adminDb))?.pageId,
        'page-1',
      )
      assert.equal(
        (await findAccountByPageId('page-1', adminDb))?.tenantId,
        tenantId,
      )
      await updateAccountAssignment(
        tenantId,
        created.id,
        { agentAutoReply: true },
        adminDb,
      )
      assert.equal(
        (await getInboxAccount(tenantId, created.id, adminDb))?.agentAutoReply,
        true,
      )
      await disconnectInboxAccount(tenantId, created.id, adminDb)
      assert.equal(await findAccountByPageId('page-1', adminDb), null)
      await deleteInboxAccount(tenantId, created.id, adminDb)
      assert.equal(await getInboxAccount(tenantId, created.id, adminDb), null)
    })
  })
})

describe('instagram conversations (pg)', () => {
  test('getOrCreate idempotent on (account, igsid); status/assign/read/agentSettings', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, accountId } = await seedAccount(adminDb)
      const a = await getOrCreateConversation(
        tenantId,
        accountId,
        '178414',
        'Bob',
        'bob',
        adminDb,
      )
      const b = await getOrCreateConversation(
        tenantId,
        accountId,
        '178414',
        undefined,
        undefined,
        adminDb,
      )
      assert.equal(a.id, b.id)
      assert.equal(
        (await listConversations(tenantId, accountId, undefined, adminDb))
          .length,
        1,
      )
      await updateConversationStatus(tenantId, accountId, '178414', 'resolved', adminDb)
      await assignConversation(tenantId, accountId, '178414', null, adminDb)
      await markAsRead(tenantId, accountId, '178414', adminDb)
      await updateConversationAgentSettings(
        tenantId,
        accountId,
        '178414',
        { agentPaused: true },
        adminDb,
      )
      const c = await getIgConversation(tenantId, accountId, '178414', adminDb)
      assert.equal(c?.status, 'resolved')
      assert.equal(c?.unreadCount, 0)
      assert.equal(c?.agentPaused, true)
    })
  })
})

describe('instagram messages (pg)', () => {
  test('insert inbound updates conversation; list chronological; status monotonic', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, accountId } = await seedAccount(adminDb)
      const convo = await getOrCreateConversation(
        tenantId,
        accountId,
        '178414',
        'Bob',
        'bob',
        adminDb,
      )
      await persistInboundMessage(
        {
          tenantId,
          accountId,
          conversationId: convo.id,
          contactIgsid: '178414',
          pageId: 'p',
          igMessageId: 'mid.in.1',
          type: 'text',
          text: 'yo',
          timestampOriginal: new Date('2026-05-25T01:00:00Z'),
          contactName: 'Bob',
          contactUsername: 'bob',
        },
        adminDb,
      )
      const msgs = await listMessages(
        tenantId,
        accountId,
        '178414',
        50,
        undefined,
        adminDb,
      )
      assert.equal(msgs.length, 1)
      assert.equal(msgs[0].text, 'yo')
      const [c] = await adminDb
        .select()
        .from(igConvTbl)
        .where(eq(igConvTbl.id, convo.id))
      assert.equal(c.unreadCount, 1)
      assert.equal(c.lastMessagePreview, 'yo')

      await persistOutboundMessage(
        {
          tenantId,
          accountId,
          conversationId: convo.id,
          contactIgsid: '178414',
          igMessageId: 'mid.out.1',
          from: 'p',
          text: 'hello',
          timestampOriginal: new Date(),
        },
        adminDb,
      )
      await updateMessageStatus('mid.out.1', 'delivered', undefined, adminDb)
      await updateMessageStatus('mid.out.1', 'sent', undefined, adminDb) // ignored (backwards)
      const [m] = await adminDb
        .select()
        .from(instagramMessages)
        .where(eq(instagramMessages.igMessageId, 'mid.out.1'))
      assert.equal(m.status, 'delivered')
    })
  })
})
