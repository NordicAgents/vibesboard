/**
 * Tests for the REAL reply adapters (reply-adapters.ts).
 *
 * sendWhatsAppAgentReply / sendInstagramAgentReply translate a channel-neutral
 * InboxReplyParams into the channel-specific send-message payload. We stub the
 * underlying channel `sendReply` SEND adapters (no real WhatsApp/Instagram API
 * calls) and assert the parameter mapping — especially the `agent:${agentId}`
 * sentinel and the per-channel contact field name.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@vibesboard/channel-whatsapp/messages', () => ({
  sendReply: vi.fn()
}))
vi.mock('@vibesboard/channel-instagram/messages', () => ({
  sendReply: vi.fn()
}))

import { sendReply as sendWhatsAppReply } from '@vibesboard/channel-whatsapp/messages'
import { sendReply as sendInstagramReply } from '@vibesboard/channel-instagram/messages'

import {
  sendWhatsAppAgentReply,
  sendInstagramAgentReply,
  type InboxReplyParams
} from './reply-adapters.ts'

const mockWaSend = vi.mocked(sendWhatsAppReply)
const mockIgSend = vi.mocked(sendInstagramReply)

const baseParams: InboxReplyParams = {
  tenantId: 'tenant-1',
  accountId: 'account-1',
  contactId: 'contact-1',
  text: 'Hello from the agent',
  agentId: 'agent-7',
  agentName: 'Support Bot'
}

beforeEach(() => {
  vi.clearAllMocks()
  mockWaSend.mockResolvedValue({ id: 'wa-msg-1' } as any)
  mockIgSend.mockResolvedValue({ id: 'ig-msg-1' } as any)
})

describe('sendWhatsAppAgentReply', () => {
  it('maps contactId -> contactPhone and stamps the agent sentinel', async () => {
    await sendWhatsAppAgentReply(baseParams)

    expect(mockWaSend).toHaveBeenCalledTimes(1)
    expect(mockWaSend).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      accountId: 'account-1',
      contactPhone: 'contact-1',
      text: 'Hello from the agent',
      userId: 'agent:agent-7',
      sentByAgentName: 'Support Bot'
    })
    // Instagram adapter must not be touched.
    expect(mockIgSend).not.toHaveBeenCalled()
  })

  it('returns whatever the channel send adapter returns', async () => {
    mockWaSend.mockResolvedValue({ id: 'persisted-wa' } as any)
    const result = await sendWhatsAppAgentReply(baseParams)
    expect(result).toEqual({ id: 'persisted-wa' })
  })

  it('propagates errors from the channel send adapter', async () => {
    mockWaSend.mockRejectedValue(new Error('whatsapp api 401'))
    await expect(sendWhatsAppAgentReply(baseParams)).rejects.toThrow(/whatsapp api 401/)
  })

  it('encodes the agentId verbatim in the userId sentinel', async () => {
    await sendWhatsAppAgentReply({ ...baseParams, agentId: 'a-b_c.123' })
    expect(mockWaSend).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'agent:a-b_c.123' })
    )
  })
})

describe('sendInstagramAgentReply', () => {
  it('maps contactId -> contactIgsid and stamps the agent sentinel', async () => {
    await sendInstagramAgentReply(baseParams)

    expect(mockIgSend).toHaveBeenCalledTimes(1)
    expect(mockIgSend).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      accountId: 'account-1',
      contactIgsid: 'contact-1',
      text: 'Hello from the agent',
      userId: 'agent:agent-7',
      sentByAgentName: 'Support Bot'
    })
    expect(mockWaSend).not.toHaveBeenCalled()
  })

  it('does not leak a contactPhone field into the Instagram payload', async () => {
    await sendInstagramAgentReply(baseParams)
    const payload = mockIgSend.mock.calls[0][0] as Record<string, unknown>
    expect(payload).not.toHaveProperty('contactPhone')
    expect(payload).toHaveProperty('contactIgsid', 'contact-1')
  })

  it('returns whatever the channel send adapter returns', async () => {
    mockIgSend.mockResolvedValue({ id: 'persisted-ig' } as any)
    const result = await sendInstagramAgentReply(baseParams)
    expect(result).toEqual({ id: 'persisted-ig' })
  })

  it('propagates errors from the channel send adapter', async () => {
    mockIgSend.mockRejectedValue(new Error('instagram api 500'))
    await expect(sendInstagramAgentReply(baseParams)).rejects.toThrow(/instagram api 500/)
  })
})
