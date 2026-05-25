import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
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
  generateWebhookSecret,
  verifyWebhookSecret,
} from '../connections.ts'

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
    isPersonal: false,
  })
  await adminDb.insert(agents).values({
    id: a,
    tenantId: t,
    userId: u,
    name: 'A',
    slug: `a-${a.slice(0, 8)}`,
    instructions: 'ok ok ok',
  })
  return { tenantId: t, agentId: a, userId: u }
}

describe('chatwoot mapper', () => {
  test('remaps encrypted token column names to legacy doc fields', () => {
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
      updatedAt: now,
    } as any)
    assert.equal(c.encryptedApiToken, 'apiEnc')
    assert.equal(c.encryptedBotToken, 'botEnc')
    assert.equal(c.webhookSecretHash, 'hash')
    assert.equal(c.totalConversations, 5)
    assert.equal(c.useAgentBot, true)
    assert.equal(c.createdAt, '2026-05-25T00:00:00.000Z')
  })
})

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? 'test-encryption-key'

describe('chatwoot connections (pg)', () => {
  test('create / list / getById (cross-tenant) / disconnect / delete / stats', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, userId } = await seedAgent(adminDb)
      const secret = generateWebhookSecret()
      const { connection } = await createChatwootConnection(
        tenantId,
        agentId,
        {
          chatwootUrl: 'https://cw.example.com/',
          apiToken: 'tok',
          accountId: 7,
          inboxId: 3,
          inboxName: 'Inbox',
          chatwootWebhookId: 9,
          webhookSecret: secret,
          useAgentBot: false,
        },
        userId,
        undefined,
        adminDb
      )
      assert.ok(connection.id)
      assert.notEqual(connection.encryptedApiToken, 'tok') // encrypted
      assert.equal(connection.chatwootUrl, 'https://cw.example.com') // trailing slash stripped

      const list = await listChatwootConnections(tenantId, agentId, 'active', adminDb)
      assert.equal(list.length, 1)

      const byId = await getChatwootConnectionById(connection.id, adminDb)
      assert.equal(byId?.tenantId, tenantId)
      assert.ok(verifyWebhookSecret(secret, byId!.webhookSecretHash))

      await updateConnectionStats(tenantId, agentId, connection.id, adminDb)
      const afterStats = await getChatwootConnection(tenantId, agentId, connection.id, adminDb)
      assert.equal(afterStats?.totalConversations, 1)

      await disconnectChatwootConnection(tenantId, agentId, connection.id, 'manual', adminDb)
      assert.equal(await getChatwootConnectionById(connection.id, adminDb), null) // only active
      await deleteChatwootConnection(tenantId, agentId, connection.id, adminDb)
      assert.equal(await getChatwootConnection(tenantId, agentId, connection.id, adminDb), null)
    })
  })
})
