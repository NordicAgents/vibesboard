import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import {
  agents,
  conversations,
  tenants,
  users,
  whatsappAccounts,
  whatsappConversations as waConvTbl,
  whatsappMessages,
} from '@vibesboard/adapter-postgres/schema'

import {
  rowToWhatsappAccount,
  rowToWhatsappConversation,
  rowToWhatsappMessage,
} from '../db.ts'
import {
  createAccountRow,
  decryptToken,
  disconnectInboxAccount,
  findAccountByWabaId,
  findByoaAccountById,
  getAccountWithToken,
  getInboxAccount,
  listInboxAccounts,
  updateAccountAssignment,
} from '../accounts.ts'
import {
  assignConversation,
  getConversation as getWaConversation,
  getOrCreateConversation,
  isWithinMessageWindow,
  linkAgentConversation,
  listConversations,
  markAsRead,
  setConversationHandoff,
  updateConversationAgentSettings,
  updateConversationStatus,
} from '../conversations.ts'
import {
  listMessages,
  persistInboundMessage,
  persistOutboundMessage,
  sendReply,
  storeInboundMessage,
  updateMessageStatus,
} from '../messages.ts'

// `getMigrateDb()`-backed functions accept an optional `db` arg; every call here
// passes `adminDb` (BYPASSRLS) from withTestDb so the per-test isolated schema is
// used instead of the real public schema.

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
  it('rowToWhatsappAccount maps row to legacy doc shape', () => {
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
    expect(acc.id).toBe('a1')
    expect(acc.accessToken).toBe('enc')
    expect(acc.connectedAt).toBe('2026-05-25T00:00:00.000Z')
    expect(acc.agentAutoReply).toBe(false)
  })

  it('rowToWhatsappConversation maps id + window', () => {
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
    expect(c.id).toBe('c1')
    expect(c.contactPhone).toBe('15551234')
    expect(c.unreadCount).toBe(2)
    expect(c.windowExpiresAt).toBe('2026-05-25T00:00:00.000Z')
  })

  it('rowToWhatsappMessage maps type/direction/status', () => {
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
    expect(m.waMessageId).toBe('wamid.1')
    expect(m.from).toBe('15551234')
    expect(m.to).toBe('p1')
    expect(m.timestamp).toBe('2026-05-25T00:00:00.000Z')
    expect(m.direction).toBe('inbound')
  })

  it('mappers coalesce nullable text fields to undefined', () => {
    const now = new Date('2026-05-25T00:00:00.000Z')
    const m = rowToWhatsappMessage({
      id: 'm2',
      tenantId: 't1',
      conversationId: 'c1',
      waMessageId: 'wamid.2',
      fromAddr: 'a',
      toAddr: 'b',
      type: 'image',
      text: null,
      mediaUrl: null,
      caption: null,
      direction: 'outbound',
      status: 'sent',
      sentBy: null,
      sentByAgentName: null,
      timestampOriginal: now,
      createdAt: now,
    } as never)
    expect(m.text).toBeUndefined()
    expect(m.mediaUrl).toBeUndefined()
    expect(m.caption).toBeUndefined()
    expect(m.sentBy).toBeUndefined()
  })
})

describe('whatsapp accounts (pg)', () => {
  it('create / list / get / disconnect / findByWaba / assignment', async () => {
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
      expect(created.id).toBeTruthy()

      const list = await listInboxAccounts(tenantId, adminDb)
      expect(list.length).toBe(1)

      const got = await getInboxAccount(tenantId, created.id, adminDb)
      expect(got?.wabaId).toBe('waba-1')

      const found = await findAccountByWabaId('waba-1', adminDb)
      expect(found?.tenantId).toBe(tenantId)

      await updateAccountAssignment(
        tenantId,
        created.id,
        { assignedAgentId: null, agentAutoReply: true },
        adminDb,
      )
      const after = await getInboxAccount(tenantId, created.id, adminDb)
      expect(after?.agentAutoReply).toBe(true)

      await disconnectInboxAccount(tenantId, created.id, adminDb)
      const disc = await getInboxAccount(tenantId, created.id, adminDb)
      expect(disc?.status).toBe('disconnected')
      expect(await findAccountByWabaId('waba-1', adminDb)).toBeNull() // only active
    })
  })

  it('getInboxAccount returns null for an unknown account id', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId } = await seedTenant(adminDb)
      const got = await getInboxAccount(tenantId, randomUUID(), adminDb)
      expect(got).toBeNull()
    })
  })

  it('findByoaAccountById only matches active BYOA accounts', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, userId } = await seedTenant(adminDb)
      // api_key account should NOT be found by the BYOA lookup
      const apiKey = await createAccountRow(
        {
          tenantId,
          wabaId: 'waba-byoa-neg',
          phoneNumberId: 'pn',
          displayPhoneNumber: '+1',
          businessName: 'Biz',
          accessTokenEncrypted: 'enc',
          connectedBy: userId,
          connectionMethod: 'api_key',
          webhookSubscribed: true,
          scopes: [],
        },
        adminDb,
      )
      expect(await findByoaAccountById(apiKey.id, adminDb)).toBeNull()

      const byoa = await createAccountRow(
        {
          tenantId,
          wabaId: 'waba-byoa-pos',
          phoneNumberId: 'pn2',
          displayPhoneNumber: '+1',
          businessName: 'Biz',
          accessTokenEncrypted: 'enc',
          connectedBy: userId,
          connectionMethod: 'byoa',
          webhookSubscribed: true,
          scopes: [],
        },
        adminDb,
      )
      const found = await findByoaAccountById(byoa.id, adminDb)
      expect(found?.tenantId).toBe(tenantId)
      expect(found?.account.id).toBe(byoa.id)
    })
  })

  it('getAccountWithToken decrypts the stored access token', async () => {
    await withTestDb(async ({ adminDb }) => {
      const prevKey = process.env.ENCRYPTION_KEY
      process.env.ENCRYPTION_KEY = 'test-encryption-key'
      try {
        const { tenantId, userId } = await seedTenant(adminDb)
        // crypto-js AES round-trip: store the encrypted form and verify decrypt
        const CryptoJS = (await import('crypto-js')).default
        const plaintext = 'EAAG-secret-graph-token'
        const encrypted = CryptoJS.AES.encrypt(
          plaintext,
          'test-encryption-key',
        ).toString()
        // sanity: the module's decryptToken reverses it
        expect(decryptToken(encrypted)).toBe(plaintext)

        const created = await createAccountRow(
          {
            tenantId,
            wabaId: 'waba-tok',
            phoneNumberId: 'pn',
            displayPhoneNumber: '+1',
            businessName: 'Biz',
            accessTokenEncrypted: encrypted,
            connectedBy: userId,
            connectionMethod: 'api_key',
            webhookSubscribed: true,
            scopes: [],
          },
          adminDb,
        )
        const { account, accessToken } = await getAccountWithToken(
          tenantId,
          created.id,
          adminDb,
        )
        expect(account.id).toBe(created.id)
        expect(accessToken).toBe(plaintext)
      } finally {
        if (prevKey === undefined) delete process.env.ENCRYPTION_KEY
        else process.env.ENCRYPTION_KEY = prevKey
      }
    })
  })

  it('getAccountWithToken throws when the account is not active', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, userId } = await seedTenant(adminDb)
      const created = await createAccountRow(
        {
          tenantId,
          wabaId: 'waba-inactive',
          phoneNumberId: 'pn',
          displayPhoneNumber: '+1',
          businessName: 'Biz',
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

  it('getAccountWithToken throws when the account does not exist', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId } = await seedTenant(adminDb)
      await expect(
        getAccountWithToken(tenantId, randomUUID(), adminDb),
      ).rejects.toThrow(/not found/)
    })
  })
})

describe('whatsapp crypto (token round-trip)', () => {
  it('decryptToken throws when ENCRYPTION_KEY is unset', () => {
    const prevKey = process.env.ENCRYPTION_KEY
    delete process.env.ENCRYPTION_KEY
    try {
      expect(() => decryptToken('anything')).toThrow(/ENCRYPTION_KEY/)
    } finally {
      if (prevKey !== undefined) process.env.ENCRYPTION_KEY = prevKey
    }
  })

  it('decryptToken reverses a crypto-js AES round-trip', async () => {
    const prevKey = process.env.ENCRYPTION_KEY
    process.env.ENCRYPTION_KEY = 'rt-key-123'
    try {
      const CryptoJS = (await import('crypto-js')).default
      const plaintext = 'tøken-😀-secret'
      const encrypted = CryptoJS.AES.encrypt(plaintext, 'rt-key-123').toString()
      expect(decryptToken(encrypted)).toBe(plaintext)
    } finally {
      if (prevKey === undefined) delete process.env.ENCRYPTION_KEY
      else process.env.ENCRYPTION_KEY = prevKey
    }
  })
})

describe('whatsapp conversations (pg)', () => {
  it('getOrCreate is idempotent on (account, contactPhone)', async () => {
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
      expect(a.id).toBe(b.id) // same row — phone normalized to digits
      expect(a.contactPhone).toBe('15551234')
    })
  })

  it('list / get / status / assign / markAsRead / agentSettings', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, accountId } = await seedAccount(adminDb)
      await getOrCreateConversation(
        tenantId,
        accountId,
        '15551234',
        'Alice',
        adminDb,
      )
      const list = await listConversations(
        tenantId,
        accountId,
        undefined,
        adminDb,
      )
      expect(list.length).toBe(1)
      const c = await getWaConversation(tenantId, accountId, '15551234', adminDb)
      expect(c?.contactName).toBe('Alice')
      await updateConversationStatus(
        tenantId,
        accountId,
        '15551234',
        'resolved',
        adminDb,
      )
      await assignConversation(tenantId, accountId, '15551234', null, adminDb)
      await markAsRead(tenantId, accountId, '15551234', adminDb)
      await updateConversationAgentSettings(
        tenantId,
        accountId,
        '15551234',
        { agentPaused: true },
        adminDb,
      )
      const c2 = await getWaConversation(
        tenantId,
        accountId,
        '15551234',
        adminDb,
      )
      expect(c2?.status).toBe('resolved')
      expect(c2?.unreadCount).toBe(0)
      expect(c2?.agentPaused).toBe(true)
    })
  })

  it('listConversations filters by status', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, accountId } = await seedAccount(adminDb)
      await getOrCreateConversation(tenantId, accountId, '111', 'A', adminDb)
      await getOrCreateConversation(tenantId, accountId, '222', 'B', adminDb)
      await updateConversationStatus(
        tenantId,
        accountId,
        '111',
        'resolved',
        adminDb,
      )
      const open = await listConversations(tenantId, accountId, 'open', adminDb)
      expect(open.length).toBe(1)
      expect(open[0].contactPhone).toBe('222')
      const resolved = await listConversations(
        tenantId,
        accountId,
        'resolved',
        adminDb,
      )
      expect(resolved.length).toBe(1)
      expect(resolved[0].contactPhone).toBe('111')
    })
  })

  it('getConversation returns null for an unknown contact', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, accountId } = await seedAccount(adminDb)
      const c = await getWaConversation(tenantId, accountId, '9999999', adminDb)
      expect(c).toBeNull()
    })
  })

  it('isWithinMessageWindow reflects the windowExpiresAt boundary', () => {
    const future = {
      windowExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    } as never
    const past = {
      windowExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    } as never
    const missing = { windowExpiresAt: undefined } as never
    expect(isWithinMessageWindow(future)).toBe(true)
    expect(isWithinMessageWindow(past)).toBe(false)
    expect(isWithinMessageWindow(missing)).toBe(false)
  })
})

describe('whatsapp messages (pg)', () => {
  it('insert inbound updates conversation; list chronological; status monotonic', async () => {
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
      expect(msgs.length).toBe(1)
      expect(msgs[0].text).toBe('hi')
      const [c] = await adminDb
        .select()
        .from(waConvTbl)
        .where(eq(waConvTbl.id, convo.id))
      expect(c.unreadCount).toBe(1)
      expect(c.lastMessagePreview).toBe('hi')

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
      expect(m.status).toBe('delivered')
    })
  })

  it('updateMessageStatus advances forward (sent -> read)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, accountId } = await seedAccount(adminDb)
      const convo = await getOrCreateConversation(
        tenantId,
        accountId,
        '777',
        'X',
        adminDb,
      )
      await persistOutboundMessage(
        {
          tenantId,
          accountId,
          conversationId: convo.id,
          contactPhone: '777',
          waMessageId: 'wamid.fwd',
          from: '+1',
          text: 'yo',
          timestampOriginal: new Date(),
        },
        adminDb,
      )
      await updateMessageStatus('wamid.fwd', 'read', undefined, adminDb)
      const [m] = await adminDb
        .select()
        .from(whatsappMessages)
        .where(eq(whatsappMessages.waMessageId, 'wamid.fwd'))
      expect(m.status).toBe('read')
    })
  })

  it('updateMessageStatus is a no-op for an unknown message id', async () => {
    await withTestDb(async ({ adminDb }) => {
      // Should resolve without throwing even though no row matches.
      await expect(
        updateMessageStatus('does-not-exist', 'delivered', undefined, adminDb),
      ).resolves.toBeUndefined()
    })
  })

  it('storeInboundMessage maps non-text types and creates the conversation', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, accountId } = await seedAccount(adminDb)
      const msg = await storeInboundMessage(
        {
          tenantId,
          accountId,
          wabaId: 'w',
          phoneNumberId: 'p',
          message: {
            id: 'wamid.img.1',
            from: '+1 (555) 000-1111',
            timestamp: '1748131200',
            type: 'image',
            image: { id: 'media-1', mime_type: 'image/jpeg', caption: 'a pic' },
          },
          contact: { wa_id: '15550001111', profile: { name: 'Bob' } },
        },
        adminDb,
      )
      expect(msg.type).toBe('image')
      expect(msg.text).toBe('a pic')
      expect(msg.mediaUrl).toBe('media-1')

      // conversation created with normalized phone
      const convo = await getWaConversation(
        tenantId,
        accountId,
        '15550001111',
        adminDb,
      )
      expect(convo).toBeTruthy()
      expect(convo?.contactProfileName).toBe('Bob')
    })
  })

  it('storeInboundMessage uses placeholder text for media without caption', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, accountId } = await seedAccount(adminDb)
      const msg = await storeInboundMessage(
        {
          tenantId,
          accountId,
          wabaId: 'w',
          phoneNumberId: 'p',
          message: {
            id: 'wamid.aud.1',
            from: '15552223333',
            timestamp: '1748131200',
            type: 'audio',
            audio: { id: 'aud-1', mime_type: 'audio/ogg' },
          },
        },
        adminDb,
      )
      expect(msg.text).toBe('[Audio]')
      expect(msg.mediaUrl).toBe('aud-1')
    })
  })

  it('listMessages returns [] for an unknown conversation', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, accountId } = await seedAccount(adminDb)
      const msgs = await listMessages(
        tenantId,
        accountId,
        '0000',
        50,
        undefined,
        adminDb,
      )
      expect(msgs).toEqual([])
    })
  })
})

describe('whatsapp sendReply (window + Graph API stub)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('throws when the conversation does not exist', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, accountId } = await seedAccount(adminDb)
      await expect(
        sendReply(
          {
            tenantId,
            accountId,
            contactPhone: '15551234',
            text: 'hi',
            userId: randomUUID(),
          },
          adminDb,
        ),
      ).rejects.toThrow(/Conversation not found/)
    })
  })

  it('throws when the 24h messaging window has expired', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, accountId } = await seedAccount(adminDb)
      const convo = await getOrCreateConversation(
        tenantId,
        accountId,
        '15551234',
        'Alice',
        adminDb,
      )
      // force the window into the past
      await adminDb
        .update(waConvTbl)
        .set({ windowExpiresAt: new Date(Date.now() - 60_000) })
        .where(eq(waConvTbl.id, convo.id))

      await expect(
        sendReply(
          {
            tenantId,
            accountId,
            contactPhone: '15551234',
            text: 'late reply',
            userId: randomUUID(),
          },
          adminDb,
        ),
      ).rejects.toThrow(/24-hour messaging window has expired/)
    })
  })

  it('sends via the Graph API (stubbed) and persists the outbound message', async () => {
    await withTestDb(async ({ adminDb }) => {
      const prevKey = process.env.ENCRYPTION_KEY
      process.env.ENCRYPTION_KEY = 'send-key'
      const realFetch = globalThis.fetch
      const fetchMock = vi.fn(async (input: any) => {
        const url = typeof input === 'string' ? input : input.url
        // outbound WhatsApp Graph API call
        if (url.includes('graph.facebook.com') && url.endsWith('/messages')) {
          return new Response(
            JSON.stringify({ messages: [{ id: 'wamid.sent.99' }] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        throw new Error(`unexpected fetch to ${url}`)
      })
      globalThis.fetch = fetchMock as never
      try {
        const { tenantId, userId } = await seedTenant(adminDb)
        // store an encrypted token so getAccountWithToken succeeds
        const CryptoJS = (await import('crypto-js')).default
        const encrypted = CryptoJS.AES.encrypt(
          'graph-token',
          'send-key',
        ).toString()
        const account = await createAccountRow(
          {
            tenantId,
            wabaId: 'waba-send',
            phoneNumberId: 'pn-send',
            displayPhoneNumber: '+15559990000',
            businessName: 'Biz',
            accessTokenEncrypted: encrypted,
            connectedBy: userId,
            connectionMethod: 'api_key',
            webhookSubscribed: true,
            scopes: [],
          },
          adminDb,
        )
        const convo = await getOrCreateConversation(
          tenantId,
          account.id,
          '15551234',
          'Alice',
          adminDb,
        )
        expect(convo.id).toBeTruthy()

        const sent = await sendReply(
          {
            tenantId,
            accountId: account.id,
            contactPhone: '+1 (555) 123-4',
            text: 'hello from agent',
            userId,
            sentByAgentName: 'Agent Smith',
          },
          adminDb,
        )

        // outbound fetch was made against the account's phone-number id
        expect(fetchMock).toHaveBeenCalledTimes(1)
        const calledUrl = fetchMock.mock.calls[0][0] as string
        expect(calledUrl).toContain('graph.facebook.com')
        expect(calledUrl).toContain('pn-send/messages')

        expect(sent.waMessageId).toBe('wamid.sent.99')
        expect(sent.direction).toBe('outbound')
        expect(sent.text).toBe('hello from agent')

        const [row] = await adminDb
          .select()
          .from(whatsappMessages)
          .where(eq(whatsappMessages.waMessageId, 'wamid.sent.99'))
        expect(row.direction).toBe('outbound')
        expect(row.sentByAgentName).toBe('Agent Smith')
      } finally {
        globalThis.fetch = realFetch
        if (prevKey === undefined) delete process.env.ENCRYPTION_KEY
        else process.env.ENCRYPTION_KEY = prevKey
      }
    })
  })

  it('propagates a Graph API error response', async () => {
    await withTestDb(async ({ adminDb }) => {
      const prevKey = process.env.ENCRYPTION_KEY
      process.env.ENCRYPTION_KEY = 'send-key-2'
      const realFetch = globalThis.fetch
      globalThis.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({ error: { message: 'rate limited' } }),
          { status: 429, headers: { 'Content-Type': 'application/json' } },
        )
      }) as never
      try {
        const { tenantId, userId } = await seedTenant(adminDb)
        const CryptoJS = (await import('crypto-js')).default
        const encrypted = CryptoJS.AES.encrypt(
          'graph-token',
          'send-key-2',
        ).toString()
        const account = await createAccountRow(
          {
            tenantId,
            wabaId: 'waba-send-err',
            phoneNumberId: 'pn-err',
            displayPhoneNumber: '+1',
            businessName: 'Biz',
            accessTokenEncrypted: encrypted,
            connectedBy: userId,
            connectionMethod: 'api_key',
            webhookSubscribed: true,
            scopes: [],
          },
          adminDb,
        )
        await getOrCreateConversation(
          tenantId,
          account.id,
          '15551234',
          'Alice',
          adminDb,
        )
        await expect(
          sendReply(
            {
              tenantId,
              accountId: account.id,
              contactPhone: '15551234',
              text: 'will fail',
              userId,
            },
            adminDb,
          ),
        ).rejects.toThrow(/Failed to send message: rate limited/)
      } finally {
        globalThis.fetch = realFetch
        if (prevKey === undefined) delete process.env.ENCRYPTION_KEY
        else process.env.ENCRYPTION_KEY = prevKey
      }
    })
  })
})

describe('whatsapp handoff + link (pg)', () => {
  it('setConversationHandoff + linkAgentConversation by id', async () => {
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
      await adminDb.insert(conversations).values({ id: acid, tenantId, agentId })

      await setConversationHandoff(tenantId, convo.id, true, adminDb)
      await linkAgentConversation(tenantId, convo.id, acid, adminDb)

      const [row] = await adminDb
        .select()
        .from(waConvTbl)
        .where(eq(waConvTbl.id, convo.id))
      expect(row.agentHandedOff).toBe(true)
      expect(row.agentConversationId).toBe(acid)
    })
  })
})
