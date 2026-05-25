import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  rowToWhatsappAccount,
  rowToWhatsappConversation,
  rowToWhatsappMessage,
} from '../db.ts'

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
