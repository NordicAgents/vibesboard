import { describe, it, expect } from 'vitest'
import {
  randomUUID,
  createHash,
  createCipheriv,
  randomBytes,
} from 'node:crypto'
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
  findByoaAccountById,
  getAccountWithToken,
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
  setConversationHandoff,
  linkAgentConversation,
  isWithinMessageWindow,
} from '../conversations.ts'
import { agents, conversations } from '@vibesboard/adapter-postgres/schema'
import {
  listMessages,
  updateMessageStatus,
  persistInboundMessage,
  persistOutboundMessage,
} from '../messages.ts'

// Produce ciphertext in crypto-js's default AES format using node:crypto, so
// the test never imports crypto-js (which, with an undefined ENCRYPTION_KEY,
// crashes on its AES key schedule with "...reading 'words'"). The format is
// base64("Salted__" + 8-byte salt + AES-256-CBC) with key+IV derived via
// OpenSSL EVP_BytesToKey(MD5), exactly what encryptToken() emits.
function cryptoJsEncrypt(plaintext: string, passphrase: string): string {
  const pass = Buffer.from(passphrase, 'utf8')
  const salt = randomBytes(8)
  let data = Buffer.alloc(0)
  let block = Buffer.alloc(0)
  while (data.length < 48) {
    block = createHash('md5')
      .update(Buffer.concat([block, pass, salt]))
      .digest()
    data = Buffer.concat([data, block])
  }
  const key = data.subarray(0, 32)
  const iv = data.subarray(32, 48)
  const cipher = createCipheriv('aes-256-cbc', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return Buffer.concat([Buffer.from('Salted__', 'utf8'), salt, ct]).toString(
    'base64',
  )
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
  it('rowToInstagramAccount maps row to legacy doc shape', () => {
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
    expect(acc.id).toBe('a1')
    expect(acc.instagramAccountId).toBe('ig1')
    expect(acc.pageId).toBe('page1')
    expect(acc.accessToken).toBe('enc')
    expect(acc.connectedAt).toBe('2026-05-25T00:00:00.000Z')
    expect(acc.agentAutoReply).toBe(false)
  })

  it('rowToInstagramAccount falls back to empty connectedBy and defaults', () => {
    const now = new Date('2026-05-25T00:00:00.000Z')
    const acc = rowToInstagramAccount({
      id: 'a2',
      tenantId: 't1',
      instagramAccountId: 'ig2',
      pageId: 'page2',
      pageName: 'Page2',
      instagramUsername: 'biz2',
      accessTokenEncrypted: 'enc2',
      scopes: null,
      status: 'disconnected',
      connectedBy: null,
      connectedAt: now,
      webhookSubscribed: false,
      metaUserId: 'meta-1',
      connectionMethod: 'byoa',
      metaAppId: 'app-1',
      metaAppSecretEncrypted: 'sec-enc',
      webhookVerifyTokenEncrypted: 'verify-enc',
      byoaWebhookUrl: 'https://x/y',
      assignedAgentId: null,
      agentAutoReply: false,
      createdAt: now,
      updatedAt: now,
    } as never)
    expect(acc.connectedBy).toBe('')
    expect(acc.scopes).toEqual([])
    expect(acc.metaUserId).toBe('meta-1')
    expect(acc.metaAppSecret).toBe('sec-enc')
    expect(acc.webhookVerifyToken).toBe('verify-enc')
    expect(acc.byoaWebhookUrl).toBe('https://x/y')
  })

  it('rowToInstagramConversation maps contactIgsid + window', () => {
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
    expect(c.contactIgsid).toBe('178414')
    expect(c.contactUsername).toBe('bob')
    expect(c.contactName).toBe(undefined)
    expect(c.windowExpiresAt).toBe('2026-05-25T00:00:00.000Z')
  })

  it('rowToInstagramMessage maps igMessageId', () => {
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
    expect(m.igMessageId).toBe('mid.1')
    expect(m.from).toBe('178414')
    expect(m.to).toBe('page1')
    expect(m.text).toBe('yo')
    expect(m.mediaUrl).toBe(undefined)
    expect(m.timestamp).toBe('2026-05-25T00:00:00.000Z')
  })
})

describe('isWithinMessageWindow', () => {
  it('returns true for a future window and false for an expired one', () => {
    const future = {
      windowExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    } as never
    const past = {
      windowExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    } as never
    expect(isWithinMessageWindow(future)).toBe(true)
    expect(isWithinMessageWindow(past)).toBe(false)
  })

  it('returns false when windowExpiresAt is missing', () => {
    expect(isWithinMessageWindow({} as never)).toBe(false)
  })
})

describe('instagram accounts (pg)', () => {
  it('create / list / get / findByPage / assign / disconnect / delete', async () => {
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
      expect(created.id).toBeTruthy()
      expect((await listInboxAccounts(tenantId, adminDb)).length).toBe(1)
      expect(
        (await getInboxAccount(tenantId, created.id, adminDb))?.pageId,
      ).toBe('page-1')
      expect((await findAccountByPageId('page-1', adminDb))?.tenantId).toBe(
        tenantId,
      )
      await updateAccountAssignment(
        tenantId,
        created.id,
        { agentAutoReply: true },
        adminDb,
      )
      expect(
        (await getInboxAccount(tenantId, created.id, adminDb))?.agentAutoReply,
      ).toBe(true)
      await disconnectInboxAccount(tenantId, created.id, adminDb)
      expect(await findAccountByPageId('page-1', adminDb)).toBe(null)
      await deleteInboxAccount(tenantId, created.id, adminDb)
      expect(await getInboxAccount(tenantId, created.id, adminDb)).toBe(null)
    })
  })

  it('getInboxAccount / findAccountByPageId are tenant + status scoped', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, userId } = await seedTenant(adminDb)
      const { tenantId: otherTenant } = await seedTenant(adminDb)
      const created = await createAccountRow(
        {
          tenantId,
          instagramAccountId: 'ig-scope',
          pageId: 'page-scope',
          pageName: 'Page',
          instagramUsername: 'biz',
          accessTokenEncrypted: 'enc',
          connectedBy: userId,
          connectionMethod: 'api_key',
          webhookSubscribed: true,
          scopes: [],
        },
        adminDb,
      )
      // A different tenant cannot read this account by id.
      expect(await getInboxAccount(otherTenant, created.id, adminDb)).toBe(null)
      // findAccountByPageId is not tenant-scoped (webhook routing) but does
      // return the owning tenant id.
      const found = await findAccountByPageId('page-scope', adminDb)
      expect(found?.tenantId).toBe(tenantId)
      // findAccountByPageId ignores disconnected accounts.
      await disconnectInboxAccount(tenantId, created.id, adminDb)
      expect(await findAccountByPageId('page-scope', adminDb)).toBe(null)
    })
  })

  it('findByoaAccountById only resolves active byoa accounts', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, userId } = await seedTenant(adminDb)
      const apiKey = await createAccountRow(
        {
          tenantId,
          instagramAccountId: 'ig-api',
          pageId: 'page-api',
          pageName: 'Page',
          instagramUsername: 'biz',
          accessTokenEncrypted: 'enc',
          connectedBy: userId,
          connectionMethod: 'api_key',
          webhookSubscribed: true,
          scopes: [],
        },
        adminDb,
      )
      const byoa = await createAccountRow(
        {
          tenantId,
          instagramAccountId: 'ig-byoa',
          pageId: 'page-byoa',
          pageName: 'Page',
          instagramUsername: 'biz',
          accessTokenEncrypted: 'enc',
          connectedBy: userId,
          connectionMethod: 'byoa',
          webhookSubscribed: true,
          scopes: [],
        },
        adminDb,
      )
      // api_key account is not a byoa account.
      expect(await findByoaAccountById(apiKey.id, adminDb)).toBe(null)
      const found = await findByoaAccountById(byoa.id, adminDb)
      expect(found?.tenantId).toBe(tenantId)
      expect(found?.account.connectionMethod).toBe('byoa')
      // disconnecting hides it.
      await disconnectInboxAccount(tenantId, byoa.id, adminDb)
      expect(await findByoaAccountById(byoa.id, adminDb)).toBe(null)
    })
  })

  it('getAccountWithToken decrypts the stored token (crypto round-trip)', async () => {
    // The harness does not set ENCRYPTION_KEY; set it for this decrypt path and
    // restore afterwards.
    const prev = process.env.ENCRYPTION_KEY
    process.env.ENCRYPTION_KEY = 'test-encryption-key-1234567890'
    try {
      await withTestDb(async ({ adminDb }) => {
        const { tenantId, userId } = await seedTenant(adminDb)
        // Store a ciphertext shaped exactly like encryptToken() produces, built
        // with node:crypto so the test never loads a crypto-js instance.
        const plaintext = 'page-token-secret-123'
        const cipher = cryptoJsEncrypt(plaintext, process.env.ENCRYPTION_KEY!)
        const created = await createAccountRow(
          {
            tenantId,
            instagramAccountId: 'ig-tok',
            pageId: 'page-tok',
            pageName: 'Page',
            instagramUsername: 'biz',
            accessTokenEncrypted: cipher,
            connectedBy: userId,
            connectionMethod: 'api_key',
            webhookSubscribed: true,
            scopes: [],
          },
          adminDb,
        )
        const { accessToken } = await getAccountWithToken(
          tenantId,
          created.id,
          adminDb,
        )
        expect(accessToken).toBe(plaintext)
      })
    } finally {
      if (prev === undefined) delete process.env.ENCRYPTION_KEY
      else process.env.ENCRYPTION_KEY = prev
    }
  })

  it('getAccountWithToken throws for missing or inactive accounts', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, userId } = await seedTenant(adminDb)
      await expect(
        getAccountWithToken(tenantId, randomUUID(), adminDb),
      ).rejects.toThrow(/not found/)

      const created = await createAccountRow(
        {
          tenantId,
          instagramAccountId: 'ig-inactive',
          pageId: 'page-inactive',
          pageName: 'Page',
          instagramUsername: 'biz',
          accessTokenEncrypted: 'enc',
          connectedBy: userId,
          connectionMethod: 'api_key',
          webhookSubscribed: true,
          scopes: [],
        },
        adminDb,
      )
      await disconnectInboxAccount(tenantId, created.id, adminDb)
      await expect(
        getAccountWithToken(tenantId, created.id, adminDb),
      ).rejects.toThrow(/not active/)
    })
  })
})

describe('instagram conversations (pg)', () => {
  it('getOrCreate idempotent on (account, igsid); status/assign/read/agentSettings', async () => {
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
      expect(a.id).toBe(b.id)
      expect(
        (await listConversations(tenantId, accountId, undefined, adminDb))
          .length,
      ).toBe(1)
      await updateConversationStatus(
        tenantId,
        accountId,
        '178414',
        'resolved',
        adminDb,
      )
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
      expect(c?.status).toBe('resolved')
      expect(c?.unreadCount).toBe(0)
      expect(c?.agentPaused).toBe(true)
    })
  })

  it('listConversations filters by status', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, accountId } = await seedAccount(adminDb)
      await getOrCreateConversation(
        tenantId,
        accountId,
        'open-1',
        undefined,
        undefined,
        adminDb,
      )
      await getOrCreateConversation(
        tenantId,
        accountId,
        'res-1',
        undefined,
        undefined,
        adminDb,
      )
      await updateConversationStatus(
        tenantId,
        accountId,
        'res-1',
        'resolved',
        adminDb,
      )
      const open = await listConversations(tenantId, accountId, 'open', adminDb)
      const resolved = await listConversations(
        tenantId,
        accountId,
        'resolved',
        adminDb,
      )
      expect(open.map((c) => c.contactIgsid)).toEqual(['open-1'])
      expect(resolved.map((c) => c.contactIgsid)).toEqual(['res-1'])
    })
  })

  it('getConversation returns null for an unknown contact', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, accountId } = await seedAccount(adminDb)
      expect(
        await getIgConversation(tenantId, accountId, 'nobody', adminDb),
      ).toBe(null)
    })
  })
})

describe('instagram messages (pg)', () => {
  it('insert inbound updates conversation; list chronological; status monotonic', async () => {
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
      expect(msgs.length).toBe(1)
      expect(msgs[0].text).toBe('yo')
      const [c] = await adminDb
        .select()
        .from(igConvTbl)
        .where(eq(igConvTbl.id, convo.id))
      expect(c.unreadCount).toBe(1)
      expect(c.lastMessagePreview).toBe('yo')

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
      expect(m.status).toBe('delivered')
    })
  })

  it('persistInboundMessage truncates the preview to 100 chars and bumps unread', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, accountId } = await seedAccount(adminDb)
      const convo = await getOrCreateConversation(
        tenantId,
        accountId,
        'long-1',
        undefined,
        undefined,
        adminDb,
      )
      const longText = 'x'.repeat(250)
      await persistInboundMessage(
        {
          tenantId,
          accountId,
          conversationId: convo.id,
          contactIgsid: 'long-1',
          pageId: 'p',
          igMessageId: 'mid.long.1',
          type: 'text',
          text: longText,
          timestampOriginal: new Date('2026-05-25T02:00:00Z'),
        },
        adminDb,
      )
      await persistInboundMessage(
        {
          tenantId,
          accountId,
          conversationId: convo.id,
          contactIgsid: 'long-1',
          pageId: 'p',
          igMessageId: 'mid.long.2',
          type: 'text',
          text: 'second',
          timestampOriginal: new Date('2026-05-25T03:00:00Z'),
        },
        adminDb,
      )
      const [c] = await adminDb
        .select()
        .from(igConvTbl)
        .where(eq(igConvTbl.id, convo.id))
      expect(c.lastMessagePreview).toBe('second')
      expect(c.unreadCount).toBe(2)
      expect(c.status).toBe('open')
    })
  })

  it('listMessages is chronological and honours the before cursor', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, accountId } = await seedAccount(adminDb)
      const convo = await getOrCreateConversation(
        tenantId,
        accountId,
        'cursor-1',
        undefined,
        undefined,
        adminDb,
      )
      const t1 = new Date('2026-05-25T01:00:00Z')
      const t2 = new Date('2026-05-25T02:00:00Z')
      const t3 = new Date('2026-05-25T03:00:00Z')
      for (const [i, ts] of [t1, t2, t3].entries()) {
        await persistInboundMessage(
          {
            tenantId,
            accountId,
            conversationId: convo.id,
            contactIgsid: 'cursor-1',
            pageId: 'p',
            igMessageId: `mid.cursor.${i}`,
            type: 'text',
            text: `m${i}`,
            timestampOriginal: ts,
          },
          adminDb,
        )
      }
      const all = await listMessages(
        tenantId,
        accountId,
        'cursor-1',
        50,
        undefined,
        adminDb,
      )
      expect(all.map((m) => m.text)).toEqual(['m0', 'm1', 'm2'])
      // before excludes messages at/after the cursor timestamp.
      const before = await listMessages(
        tenantId,
        accountId,
        'cursor-1',
        50,
        t3.toISOString(),
        adminDb,
      )
      expect(before.map((m) => m.text)).toEqual(['m0', 'm1'])
    })
  })

  it('listMessages returns [] for an unknown conversation', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, accountId } = await seedAccount(adminDb)
      expect(
        await listMessages(tenantId, accountId, 'nobody', 50, undefined, adminDb),
      ).toEqual([])
    })
  })

  it('updateMessageStatus ignores inbound + unknown ids, and advances forward', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, accountId } = await seedAccount(adminDb)
      const convo = await getOrCreateConversation(
        tenantId,
        accountId,
        'status-1',
        undefined,
        undefined,
        adminDb,
      )
      // Unknown id is a silent no-op.
      await updateMessageStatus('does-not-exist', 'delivered', undefined, adminDb)

      // Inbound messages are never advanced.
      await persistInboundMessage(
        {
          tenantId,
          accountId,
          conversationId: convo.id,
          contactIgsid: 'status-1',
          pageId: 'p',
          igMessageId: 'mid.in.status',
          type: 'text',
          text: 'hi',
          timestampOriginal: new Date(),
        },
        adminDb,
      )
      await updateMessageStatus('mid.in.status', 'delivered', undefined, adminDb)
      const [inbound] = await adminDb
        .select()
        .from(instagramMessages)
        .where(eq(instagramMessages.igMessageId, 'mid.in.status'))
      expect(inbound.status).toBe('received')

      // Outbound advances sent -> read but not backwards (delivered after read
      // is ignored).
      await persistOutboundMessage(
        {
          tenantId,
          accountId,
          conversationId: convo.id,
          contactIgsid: 'status-1',
          igMessageId: 'mid.out.status',
          from: 'p',
          text: 'hey',
          timestampOriginal: new Date(),
        },
        adminDb,
      )
      await updateMessageStatus('mid.out.status', 'read', undefined, adminDb)
      await updateMessageStatus('mid.out.status', 'delivered', undefined, adminDb)
      const [outbound] = await adminDb
        .select()
        .from(instagramMessages)
        .where(eq(instagramMessages.igMessageId, 'mid.out.status'))
      expect(outbound.status).toBe('read')
    })
  })
})

describe('instagram handoff + link (pg)', () => {
  it('setConversationHandoff + linkAgentConversation by id', async () => {
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
      // Seed a real agent + core conversation so agent_conversation_id FK resolves.
      const agentId = randomUUID()
      const acid = randomUUID()
      await adminDb.insert(agents).values({
        id: agentId,
        tenantId,
        name: 'A',
        slug: `a-${agentId.slice(0, 8)}`,
      })
      await adminDb.insert(conversations).values({ id: acid, tenantId, agentId })

      await setConversationHandoff(tenantId, convo.id, true, adminDb)
      await linkAgentConversation(tenantId, convo.id, acid, adminDb)

      const [row] = await adminDb
        .select()
        .from(igConvTbl)
        .where(eq(igConvTbl.id, convo.id))
      expect(row.agentHandedOff).toBe(true)
      expect(row.agentConversationId).toBe(acid)
    })
  })
})
