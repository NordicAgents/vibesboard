import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { rowToChatwootConnection } from '../db.ts'

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
