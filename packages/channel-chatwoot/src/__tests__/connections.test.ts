import { describe, it, expect } from 'vitest'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, agents } from '@vibesboard/adapter-postgres/schema'
import { rowToChatwootConnection } from '../db.ts'
import {
  createChatwootConnection,
  listChatwootConnections,
  getChatwootConnection,
  getChatwootConnectionById,
  disconnectChatwootConnection,
  deleteChatwootConnection,
  updateConnectionStats,
  generateConnectionId,
  generateWebhookSecret,
  verifyWebhookSecret,
  verifyChatwootSignature,
  decryptToken
} from '../connections.ts'

// Encryption key must be set before connections.ts encrypt/decrypt runs.
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? 'test-encryption-key'

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
    instructions: 'ok ok ok'
  })
  return { tenantId: t, agentId: a, userId: u }
}

const baseParams = (overrides: Record<string, unknown> = {}) => ({
  chatwootUrl: 'https://cw.example.com/',
  apiToken: 'tok',
  accountId: 7,
  inboxId: 3,
  inboxName: 'Inbox',
  chatwootWebhookId: 9,
  webhookSecret: generateWebhookSecret(),
  useAgentBot: false,
  ...overrides
})

// Local sha256 hex helper mirroring connections.ts hashSecret (which is private).
function sha256Hex(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

describe('chatwoot mapper (rowToChatwootConnection)', () => {
  it('remaps encrypted token column names to legacy doc fields', () => {
    const now = new Date('2026-05-25T00:00:00.000Z')
    const c = rowToChatwootConnection({
      id: 'c1',
      tenantId: 't1',
      agentId: 'ag1',
      userId: 'u1',
      chatwootUrl: 'https://x',
      chatwootAccountId: 7,
      chatwootInboxId: 3,
      chatwootInboxName: 'Inbox',
      apiTokenEncrypted: 'apiEnc',
      chatwootWebhookId: 9,
      agentBotId: 2,
      agentBotName: 'Bot',
      botTokenEncrypted: 'botEnc',
      useAgentBot: true,
      webhookSecretHash: 'hash',
      status: 'active',
      lastMessageReceivedAt: null,
      totalConversations: 5,
      disconnectedAt: null,
      disconnectionReason: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now
    } as any)
    expect(c.encryptedApiToken).toBe('apiEnc')
    expect(c.encryptedBotToken).toBe('botEnc')
    expect(c.webhookSecretHash).toBe('hash')
    expect(c.totalConversations).toBe(5)
    expect(c.useAgentBot).toBe(true)
    expect(c.createdAt).toBe('2026-05-25T00:00:00.000Z')
  })

  it('coalesces nullable columns to defaults / undefined', () => {
    const now = new Date('2026-05-25T00:00:00.000Z')
    const c = rowToChatwootConnection({
      id: 'c2',
      tenantId: 't2',
      agentId: 'ag2',
      userId: null,
      chatwootUrl: 'https://y',
      chatwootAccountId: 1,
      chatwootInboxId: 1,
      chatwootInboxName: 'I',
      apiTokenEncrypted: 'enc',
      chatwootWebhookId: null,
      agentBotId: null,
      agentBotName: null,
      botTokenEncrypted: null,
      useAgentBot: false,
      webhookSecretHash: 'h',
      status: 'disconnected',
      lastMessageReceivedAt: null,
      totalConversations: 0,
      disconnectedAt: null,
      disconnectionReason: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now
    } as any)
    // userId null -> '' (legacy doc shape)
    expect(c.userId).toBe('')
    expect(c.chatwootWebhookId).toBeNull()
    expect(c.agentBotId).toBeNull()
    expect(c.agentBotName).toBeNull()
    expect(c.encryptedBotToken).toBeNull()
    // optional fields absent
    expect(c.lastMessageReceivedAt).toBeUndefined()
    expect(c.disconnectedAt).toBeUndefined()
    expect(c.disconnectionReason).toBeUndefined()
    expect(c.errorMessage).toBeUndefined()
  })

  it('serializes nullable date columns to ISO strings when present', () => {
    const created = new Date('2026-05-25T00:00:00.000Z')
    const last = new Date('2026-05-26T10:11:12.000Z')
    const disc = new Date('2026-05-27T00:00:00.000Z')
    const c = rowToChatwootConnection({
      id: 'c3',
      tenantId: 't3',
      agentId: 'ag3',
      userId: 'u3',
      chatwootUrl: 'https://z',
      chatwootAccountId: 2,
      chatwootInboxId: 2,
      chatwootInboxName: 'I',
      apiTokenEncrypted: 'enc',
      chatwootWebhookId: 4,
      agentBotId: null,
      agentBotName: null,
      botTokenEncrypted: null,
      useAgentBot: false,
      webhookSecretHash: 'h',
      status: 'disconnected',
      lastMessageReceivedAt: last,
      totalConversations: 3,
      disconnectedAt: disc,
      disconnectionReason: 'manual',
      errorMessage: 'boom',
      createdAt: created,
      updatedAt: created
    } as any)
    expect(c.lastMessageReceivedAt).toBe('2026-05-26T10:11:12.000Z')
    expect(c.disconnectedAt).toBe('2026-05-27T00:00:00.000Z')
    expect(c.disconnectionReason).toBe('manual')
    expect(c.errorMessage).toBe('boom')
  })
})

describe('chatwoot id / secret generators', () => {
  it('generateConnectionId returns a uuid-shaped string', () => {
    const id = generateConnectionId()
    expect(id).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it('generateWebhookSecret returns a 32-char alphanumeric secret, unique per call', () => {
    const a = generateWebhookSecret()
    const b = generateWebhookSecret()
    expect(a).toMatch(/^[0-9A-Za-z]{32}$/)
    expect(a).not.toBe(b)
  })
})

describe('chatwoot webhook secret hashing / verification', () => {
  it('verifyWebhookSecret matches a hash produced for the same secret', () => {
    const secret = generateWebhookSecret()
    expect(verifyWebhookSecret(secret, sha256Hex(secret))).toBe(true)
  })

  it('verifyWebhookSecret rejects the wrong secret (same length hash)', () => {
    const secret = generateWebhookSecret()
    const other = generateWebhookSecret()
    expect(verifyWebhookSecret(other, sha256Hex(secret))).toBe(false)
  })

  it('verifyWebhookSecret returns false when stored hash has a different length', () => {
    const secret = generateWebhookSecret()
    // A truncated hash has a different byte length -> early false, no throw.
    expect(verifyWebhookSecret(secret, sha256Hex(secret).slice(0, 10))).toBe(
      false
    )
  })

  it('verifyWebhookSecret returns false for an empty stored hash', () => {
    expect(verifyWebhookSecret('anything', '')).toBe(false)
  })
})

describe('Chatwoot signed webhook verification', () => {
  it('verifies an HMAC over the exact raw request body', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, userId } = await seedAgent(adminDb)
      const secret = generateWebhookSecret()
      const { connection } = await createChatwootConnection(
        tenantId,
        agentId,
        baseParams({ webhookSecret: secret }),
        userId,
        undefined,
        adminDb
      )
      const body = '{"event":"message_created"}'
      const timestamp = String(Math.floor(Date.now() / 1_000))
      const signature = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`

      expect(
        verifyChatwootSignature(
          body,
          signature,
          timestamp,
          connection.webhookSecretHash
        )
      ).toBe(true)
      expect(
        verifyChatwootSignature(
          `${body} `,
          signature,
          timestamp,
          connection.webhookSecretHash
        )
      ).toBe(false)
      expect(
        verifyChatwootSignature(
          body,
          signature,
          String(Number(timestamp) - 301),
          connection.webhookSecretHash
        )
      ).toBe(false)
    })
  })
})

describe('chatwoot credential encryption (crypto-js round-trip)', () => {
  it('encrypts the api token in storage and decrypts back to plaintext', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, userId } = await seedAgent(adminDb)
      const { connection } = await createChatwootConnection(
        tenantId,
        agentId,
        baseParams({ apiToken: 'super-secret-token' }),
        userId,
        undefined,
        adminDb
      )
      // Stored ciphertext must NOT equal the plaintext.
      expect(connection.encryptedApiToken).not.toBe('super-secret-token')
      // Round-trips back to the original plaintext.
      expect(decryptToken(connection.encryptedApiToken)).toBe(
        'super-secret-token'
      )
    })
  })

  it('encrypts the bot token only when provided, else stores null', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, userId } = await seedAgent(adminDb)

      const withBot = await createChatwootConnection(
        tenantId,
        agentId,
        baseParams({
          apiToken: 'user-tok',
          botToken: 'bot-tok',
          useAgentBot: true,
          agentBotId: 11,
          agentBotName: 'AgentBot'
        }),
        userId,
        undefined,
        adminDb
      )
      expect(withBot.connection.encryptedBotToken).not.toBeNull()
      expect(withBot.connection.encryptedBotToken).not.toBe('bot-tok')
      expect(decryptToken(withBot.connection.encryptedBotToken!)).toBe(
        'bot-tok'
      )
      expect(withBot.connection.useAgentBot).toBe(true)
      expect(withBot.connection.agentBotId).toBe(11)
      expect(withBot.connection.agentBotName).toBe('AgentBot')

      const noBot = await createChatwootConnection(
        tenantId,
        agentId,
        baseParams({ apiToken: 'user-tok-2' }),
        userId,
        undefined,
        adminDb
      )
      expect(noBot.connection.encryptedBotToken).toBeNull()
    })
  })

  it('produces distinct ciphertexts for the same plaintext (random IV)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, userId } = await seedAgent(adminDb)
      const a = await createChatwootConnection(
        tenantId,
        agentId,
        baseParams({ apiToken: 'same-token' }),
        userId,
        undefined,
        adminDb
      )
      const b = await createChatwootConnection(
        tenantId,
        agentId,
        baseParams({ apiToken: 'same-token' }),
        userId,
        undefined,
        adminDb
      )
      // CryptoJS AES uses a random salt/IV -> ciphertexts differ...
      expect(a.connection.encryptedApiToken).not.toBe(
        b.connection.encryptedApiToken
      )
      // ...but both decrypt to the same plaintext.
      expect(decryptToken(a.connection.encryptedApiToken)).toBe('same-token')
      expect(decryptToken(b.connection.encryptedApiToken)).toBe('same-token')
    })
  })
})

describe('chatwoot connections CRUD (pg)', () => {
  it('create normalizes the url and stores active status', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, userId } = await seedAgent(adminDb)
      const secret = generateWebhookSecret()
      const { connection, webhookSecret } = await createChatwootConnection(
        tenantId,
        agentId,
        baseParams({ webhookSecret: secret }),
        userId,
        undefined,
        adminDb
      )
      expect(connection.id).toBeTruthy()
      // trailing slash stripped from the url
      expect(connection.chatwootUrl).toBe('https://cw.example.com')
      expect(connection.status).toBe('active')
      expect(connection.totalConversations).toBe(0)
      // create echoes back the raw webhook secret for one-time display
      expect(webhookSecret).toBe(secret)
      // and the stored value is encrypted while still verifying signed bodies
      expect(connection.webhookSecretHash).not.toContain(secret)
      const body = '{}'
      const timestamp = String(Math.floor(Date.now() / 1_000))
      const signature = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`
      expect(
        verifyChatwootSignature(
          body,
          signature,
          timestamp,
          connection.webhookSecretHash
        )
      ).toBe(true)
    })
  })

  it('strips multiple trailing slashes from the url', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, userId } = await seedAgent(adminDb)
      const { connection } = await createChatwootConnection(
        tenantId,
        agentId,
        baseParams({ chatwootUrl: 'https://cw.example.com///' }),
        userId,
        undefined,
        adminDb
      )
      expect(connection.chatwootUrl).toBe('https://cw.example.com')
    })
  })

  it('honors a caller-supplied uuid connectionId, ignoring malformed ids', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, userId } = await seedAgent(adminDb)

      const fixedId = randomUUID()
      const used = await createChatwootConnection(
        tenantId,
        agentId,
        baseParams(),
        userId,
        fixedId,
        adminDb
      )
      expect(used.connection.id).toBe(fixedId)

      // A non-uuid id is rejected and a generated uuid is used instead.
      const generated = await createChatwootConnection(
        tenantId,
        agentId,
        baseParams(),
        userId,
        'not-a-uuid',
        adminDb
      )
      expect(generated.connection.id).not.toBe('not-a-uuid')
      expect(generated.connection.id).toMatch(/^[0-9a-f-]{36}$/i)
    })
  })

  it('full lifecycle: create / list / getById (cross-tenant) / stats / disconnect / delete', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, userId } = await seedAgent(adminDb)
      const secret = generateWebhookSecret()
      const { connection } = await createChatwootConnection(
        tenantId,
        agentId,
        baseParams({ apiToken: 'tok', webhookSecret: secret }),
        userId,
        undefined,
        adminDb
      )
      expect(connection.id).toBeTruthy()
      expect(connection.encryptedApiToken).not.toBe('tok')

      const list = await listChatwootConnections(
        tenantId,
        agentId,
        'active',
        adminDb
      )
      expect(list.length).toBe(1)

      // getById looks up across tenants/agents (webhook handler path)
      const byId = await getChatwootConnectionById(connection.id, adminDb)
      expect(byId?.tenantId).toBe(tenantId)
      const body = '{}'
      const timestamp = String(Math.floor(Date.now() / 1_000))
      const signature = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`
      expect(
        verifyChatwootSignature(
          body,
          signature,
          timestamp,
          byId!.webhookSecretHash
        )
      ).toBe(true)

      await updateConnectionStats(tenantId, agentId, connection.id, adminDb)
      const afterStats = await getChatwootConnection(
        tenantId,
        agentId,
        connection.id,
        adminDb
      )
      expect(afterStats?.totalConversations).toBe(1)
      expect(afterStats?.lastMessageReceivedAt).toBeTruthy()

      await disconnectChatwootConnection(
        tenantId,
        agentId,
        connection.id,
        'manual',
        adminDb
      )
      // getById only returns active connections
      expect(await getChatwootConnectionById(connection.id, adminDb)).toBeNull()
      // but the tenant-scoped getter still finds the disconnected row
      const disconnected = await getChatwootConnection(
        tenantId,
        agentId,
        connection.id,
        adminDb
      )
      expect(disconnected?.status).toBe('disconnected')
      expect(disconnected?.disconnectionReason).toBe('manual')
      expect(disconnected?.disconnectedAt).toBeTruthy()

      await deleteChatwootConnection(tenantId, agentId, connection.id, adminDb)
      expect(
        await getChatwootConnection(tenantId, agentId, connection.id, adminDb)
      ).toBeNull()
    })
  })

  it('disconnect without a reason stores a null reason', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, userId } = await seedAgent(adminDb)
      const { connection } = await createChatwootConnection(
        tenantId,
        agentId,
        baseParams(),
        userId,
        undefined,
        adminDb
      )
      await disconnectChatwootConnection(
        tenantId,
        agentId,
        connection.id,
        undefined,
        adminDb
      )
      const row = await getChatwootConnection(
        tenantId,
        agentId,
        connection.id,
        adminDb
      )
      expect(row?.status).toBe('disconnected')
      expect(row?.disconnectionReason).toBeUndefined()
    })
  })

  it('updateConnectionStats increments cumulatively', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, userId } = await seedAgent(adminDb)
      const { connection } = await createChatwootConnection(
        tenantId,
        agentId,
        baseParams(),
        userId,
        undefined,
        adminDb
      )
      await updateConnectionStats(tenantId, agentId, connection.id, adminDb)
      await updateConnectionStats(tenantId, agentId, connection.id, adminDb)
      await updateConnectionStats(tenantId, agentId, connection.id, adminDb)
      const row = await getChatwootConnection(
        tenantId,
        agentId,
        connection.id,
        adminDb
      )
      expect(row?.totalConversations).toBe(3)
    })
  })

  it('list filters by status and returns both rows without a filter', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, userId } = await seedAgent(adminDb)

      const first = await createChatwootConnection(
        tenantId,
        agentId,
        baseParams({ inboxId: 1, inboxName: 'one' }),
        userId,
        undefined,
        adminDb
      )
      const second = await createChatwootConnection(
        tenantId,
        agentId,
        baseParams({ inboxId: 2, inboxName: 'two' }),
        userId,
        undefined,
        adminDb
      )

      // No status filter -> both returned (createdAt desc ordering; defaultNow
      // can tie at sub-ms, so assert membership rather than strict order).
      const all = await listChatwootConnections(
        tenantId,
        agentId,
        undefined,
        adminDb
      )
      expect(all.length).toBe(2)
      expect(all.map(c => c.id).sort()).toEqual(
        [first.connection.id, second.connection.id].sort()
      )

      // Disconnect one; active filter returns only the remaining active row.
      await disconnectChatwootConnection(
        tenantId,
        agentId,
        first.connection.id,
        'x',
        adminDb
      )
      const active = await listChatwootConnections(
        tenantId,
        agentId,
        'active',
        adminDb
      )
      expect(active.length).toBe(1)
      expect(active[0]!.id).toBe(second.connection.id)

      const disconnected = await listChatwootConnections(
        tenantId,
        agentId,
        'disconnected',
        adminDb
      )
      expect(disconnected.length).toBe(1)
      expect(disconnected[0]!.id).toBe(first.connection.id)
    })
  })

  it('returns null for a missing connection id', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      expect(await getChatwootConnectionById(randomUUID(), adminDb)).toBeNull()
      expect(
        await getChatwootConnection(tenantId, agentId, randomUUID(), adminDb)
      ).toBeNull()
    })
  })
})

describe('chatwoot connections tenant isolation (pg)', () => {
  it('does not leak a connection across tenants/agents', async () => {
    await withTestDb(async ({ adminDb }) => {
      const tenantA = await seedAgent(adminDb)
      const tenantB = await seedAgent(adminDb)

      const { connection } = await createChatwootConnection(
        tenantA.tenantId,
        tenantA.agentId,
        baseParams(),
        tenantA.userId,
        undefined,
        adminDb
      )

      // Wrong tenant cannot read tenant A's connection by the scoped getter.
      expect(
        await getChatwootConnection(
          tenantB.tenantId,
          tenantB.agentId,
          connection.id,
          adminDb
        )
      ).toBeNull()

      // Wrong tenant lists are empty.
      expect(
        (
          await listChatwootConnections(
            tenantB.tenantId,
            tenantB.agentId,
            undefined,
            adminDb
          )
        ).length
      ).toBe(0)

      // Wrong tenant cannot disconnect tenant A's connection.
      await disconnectChatwootConnection(
        tenantB.tenantId,
        tenantB.agentId,
        connection.id,
        'x',
        adminDb
      )
      const stillActive = await getChatwootConnectionById(
        connection.id,
        adminDb
      )
      expect(stillActive?.status).toBe('active')

      // Wrong tenant cannot delete tenant A's connection.
      await deleteChatwootConnection(
        tenantB.tenantId,
        tenantB.agentId,
        connection.id,
        adminDb
      )
      expect(
        await getChatwootConnectionById(connection.id, adminDb)
      ).not.toBeNull()
    })
  })
})
