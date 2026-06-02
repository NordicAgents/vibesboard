/**
 * Tests for inbox-agent feature: agent resolution, handler flow, reply adapters.
 *
 * These are pure-logic tests - they validate the resolution logic, sentinel
 * patterns, message flow, and edge cases without hitting external services.
 *
 * Migrated from node:test to Vitest (intent preserved). The replicated helpers
 * mirror behaviour in the real modules (sentinel = reply-adapters.ts;
 * externalId = handler.ts; resolution decision tree = resolve-agent.ts; window
 * check = handler.ts step 2). The full real-module behaviour is covered by
 * resolve-agent.test.ts / handler.test.ts / reply-adapters.test.ts.
 */
import { describe, it, expect } from 'vitest'

type InboxChannel = 'whatsapp' | 'instagram'

// Replicate the sentinel pattern used for agent-sent messages.
function makeAgentSentBy(agentId: string): string {
  return `agent:${agentId}`
}

function isAgentSentMessage(sentBy?: string): boolean {
  return !!sentBy?.startsWith('agent:')
}

function extractAgentIdFromSentBy(sentBy: string): string | null {
  if (!sentBy.startsWith('agent:')) return null
  return sentBy.slice('agent:'.length)
}

// Replicate externalId construction.
function buildExternalId(
  channel: InboxChannel,
  accountId: string,
  contactId: string
): string {
  return `inbox:${channel}:${accountId}:${contactId}`
}

// Replicate agent resolution logic (decision tree only, no DB access).
interface MockConversation {
  assignedAgentId?: string | null
  agentPaused?: boolean
  agentHandedOff?: boolean
}

interface MockAccount {
  assignedAgentId?: string | null
  agentAutoReply?: boolean
}

function resolveEffectiveAgentId(
  conversation: MockConversation | null,
  account: MockAccount | null
): string | null {
  if (conversation?.agentPaused || conversation?.agentHandedOff) {
    return null
  }
  if (conversation?.assignedAgentId) {
    return conversation.assignedAgentId
  }
  if (account?.agentAutoReply === false) {
    return null
  }
  return account?.assignedAgentId || null
}

// Replicate 24h window check.
function isWindowExpired(windowExpiresAt: string): boolean {
  return new Date(windowExpiresAt) <= new Date()
}

describe('Agent sentBy sentinel pattern', () => {
  it('creates correct sentinel value', () => {
    expect(makeAgentSentBy('abc123')).toBe('agent:abc123')
  })

  it('detects agent-sent messages', () => {
    expect(isAgentSentMessage('agent:abc123')).toBe(true)
    expect(isAgentSentMessage('agent:')).toBe(true)
    expect(isAgentSentMessage('user123')).toBe(false)
    expect(isAgentSentMessage(undefined)).toBe(false)
    expect(isAgentSentMessage('')).toBe(false)
  })

  it('extracts agent ID from sentinel', () => {
    expect(extractAgentIdFromSentBy('agent:abc123')).toBe('abc123')
    expect(extractAgentIdFromSentBy('agent:a-b_c')).toBe('a-b_c')
    expect(extractAgentIdFromSentBy('user123')).toBe(null)
  })

  it('sentinel is never a valid user ID', () => {
    const sentinel = makeAgentSentBy('someAgentId')
    expect(sentinel.includes(':')).toBeTruthy()
  })
})

describe('External ID construction', () => {
  it('WhatsApp format', () => {
    expect(buildExternalId('whatsapp', 'acc123', '5511999')).toBe(
      'inbox:whatsapp:acc123:5511999'
    )
  })

  it('Instagram format', () => {
    expect(buildExternalId('instagram', 'acc456', 'igsid789')).toBe(
      'inbox:instagram:acc456:igsid789'
    )
  })

  it('different contacts produce different IDs', () => {
    expect(buildExternalId('whatsapp', 'acc1', 'phone1')).not.toBe(
      buildExternalId('whatsapp', 'acc1', 'phone2')
    )
  })

  it('different channels produce different IDs', () => {
    expect(buildExternalId('whatsapp', 'acc1', 'contact1')).not.toBe(
      buildExternalId('instagram', 'acc1', 'contact1')
    )
  })
})

describe('Agent resolution logic', () => {
  it('returns conversation-level agent override', () => {
    expect(
      resolveEffectiveAgentId({ assignedAgentId: 'convo-agent' }, { assignedAgentId: 'account-agent' })
    ).toBe('convo-agent')
  })

  it('falls back to account-level agent when no conversation override', () => {
    expect(
      resolveEffectiveAgentId({ assignedAgentId: null }, { assignedAgentId: 'account-agent' })
    ).toBe('account-agent')
  })

  it('returns null when no agent assigned anywhere', () => {
    expect(resolveEffectiveAgentId({}, {})).toBe(null)
  })

  it('returns null when agent is paused on conversation', () => {
    expect(
      resolveEffectiveAgentId({ assignedAgentId: 'agent1', agentPaused: true }, { assignedAgentId: 'agent1' })
    ).toBe(null)
  })

  it('returns null when conversation is handed off', () => {
    expect(
      resolveEffectiveAgentId({ assignedAgentId: 'agent1', agentHandedOff: true }, { assignedAgentId: 'agent1' })
    ).toBe(null)
  })

  it('returns null when agentAutoReply is false on account', () => {
    expect(
      resolveEffectiveAgentId({}, { assignedAgentId: 'agent1', agentAutoReply: false })
    ).toBe(null)
  })

  it('agentAutoReply defaults to true (undefined means auto-reply enabled)', () => {
    expect(resolveEffectiveAgentId({}, { assignedAgentId: 'agent1' })).toBe('agent1')
  })

  it('conversation override bypasses account agentAutoReply=false', () => {
    expect(
      resolveEffectiveAgentId(
        { assignedAgentId: 'convo-agent' },
        { assignedAgentId: 'account-agent', agentAutoReply: false }
      )
    ).toBe('convo-agent')
  })

  it('handles null conversation (new contact, no doc yet)', () => {
    expect(resolveEffectiveAgentId(null, { assignedAgentId: 'agent1' })).toBe('agent1')
  })

  it('handles null account', () => {
    expect(resolveEffectiveAgentId({}, null)).toBe(null)
  })
})

describe('24h messaging window', () => {
  it('window is open when expiry is in the future', () => {
    expect(isWindowExpired(new Date(Date.now() + 60_000).toISOString())).toBe(false)
  })

  it('window is expired when expiry is in the past', () => {
    expect(isWindowExpired(new Date(Date.now() - 60_000).toISOString())).toBe(true)
  })

  it('window is expired at exact expiry time', () => {
    // The logic uses <= so "now" should be expired.
    expect(isWindowExpired(new Date().toISOString())).toBe(true)
  })
})

describe('Handoff flow', () => {
  it('handoff marker detection (replicated from completion.ts)', () => {
    const HANDOFF_MARKER = '[HANDOFF_TO_HUMAN]'
    const text1 = 'Let me connect you with a human agent. [HANDOFF_TO_HUMAN]'
    expect(text1.includes(HANDOFF_MARKER)).toBeTruthy()
    const text2 = 'Here is the answer to your question.'
    expect(text2.includes(HANDOFF_MARKER)).toBe(false)
    expect(text1.replace(HANDOFF_MARKER, '').trim()).toBe(
      'Let me connect you with a human agent.'
    )
  })

  it('re-engage flow resets flags', () => {
    const convo: MockConversation = {
      assignedAgentId: 'agent1',
      agentHandedOff: true,
      agentPaused: false
    }
    expect(resolveEffectiveAgentId(convo, null)).toBe(null)
    convo.agentHandedOff = false
    expect(resolveEffectiveAgentId(convo, null)).toBe('agent1')
  })

  it('pause + resume cycle', () => {
    const convo: MockConversation = { assignedAgentId: 'agent1' }
    expect(resolveEffectiveAgentId(convo, null)).toBe('agent1')
    convo.agentPaused = true
    expect(resolveEffectiveAgentId(convo, null)).toBe(null)
    convo.agentPaused = false
    expect(resolveEffectiveAgentId(convo, null)).toBe('agent1')
  })
})

describe('Message dual-store linking', () => {
  it('inbox message stores agent sentinel in sentBy', () => {
    const msgDoc = {
      sentBy: makeAgentSentBy('abc123'),
      sentByAgentName: 'Support Bot',
      direction: 'outbound' as const
    }
    expect(msgDoc.sentBy).toBe('agent:abc123')
    expect(msgDoc.sentByAgentName).toBe('Support Bot')
    expect(isAgentSentMessage(msgDoc.sentBy)).toBe(true)
  })

  it('human message has userId in sentBy, no agent name', () => {
    expect(isAgentSentMessage('user-uid-123')).toBe(false)
  })
})

describe('Handoff instructions injection', () => {
  const handoffSuffix =
    '\n\nIMPORTANT: If the customer asks to speak to a human agent, requests escalation, or you cannot resolve their issue, let them know you are connecting them with a human agent and end your response with [HANDOFF_TO_HUMAN].'

  it('instructions are appended, not replaced', () => {
    const original = 'You are a helpful support agent.'
    const injected = original + handoffSuffix
    expect(injected.startsWith(original)).toBeTruthy()
    expect(injected.includes('[HANDOFF_TO_HUMAN]')).toBeTruthy()
    expect(injected.length > original.length).toBeTruthy()
  })

  it('works with empty instructions', () => {
    const emptyInstructions = '' as string
    const injected = (emptyInstructions || '') + handoffSuffix
    expect(injected.includes('[HANDOFF_TO_HUMAN]')).toBeTruthy()
  })
})

describe('Message deduplication', () => {
  it('new user message is appended when not in history', () => {
    const prior = [
      { id: 'msg1', role: 'user' as const, content: 'Hello' },
      { id: 'msg2', role: 'assistant' as const, content: 'Hi there!' }
    ]
    const userMessage = { id: 'msg3', role: 'user' as const, content: 'Help me' }
    const hasDuplicate = prior.some(m => m.id === userMessage.id)
    const allMessages = hasDuplicate ? prior : [...prior, userMessage]
    expect(allMessages.length).toBe(3)
    expect(allMessages[2].content).toBe('Help me')
  })

  it('duplicate user message is not re-added', () => {
    const userMessage = { id: 'msg1', role: 'user' as const, content: 'Hello' }
    const prior = [userMessage]
    const hasDuplicate = prior.some(m => m.id === userMessage.id)
    const allMessages = hasDuplicate ? prior : [...prior, userMessage]
    expect(allMessages.length).toBe(1)
  })
})

describe('Account PATCH validation logic', () => {
  it('assigning agent sets agentAutoReply to true by default', () => {
    const body = { assignedAgentId: 'agent1' }
    const updates: Record<string, any> = {}
    if (body.assignedAgentId !== undefined) {
      updates.assignedAgentId = body.assignedAgentId || null
      if ((body as any).agentAutoReply === undefined && body.assignedAgentId) {
        updates.agentAutoReply = true
      }
    }
    expect(updates.assignedAgentId).toBe('agent1')
    expect(updates.agentAutoReply).toBe(true)
  })

  it('unassigning agent sets assignedAgentId to null', () => {
    const body = { assignedAgentId: null }
    const updates: Record<string, any> = {}
    if (body.assignedAgentId !== undefined) {
      updates.assignedAgentId = body.assignedAgentId || null
    }
    expect(updates.assignedAgentId).toBe(null)
    expect(updates.agentAutoReply).toBe(undefined)
  })

  it('explicit agentAutoReply=false is respected', () => {
    const body = { assignedAgentId: 'agent1', agentAutoReply: false }
    const updates: Record<string, any> = {}
    if (body.assignedAgentId !== undefined) {
      updates.assignedAgentId = body.assignedAgentId || null
      if (body.agentAutoReply === undefined && body.assignedAgentId) {
        updates.agentAutoReply = true
      }
    }
    if (body.agentAutoReply !== undefined) {
      updates.agentAutoReply = body.agentAutoReply
    }
    expect(updates.assignedAgentId).toBe('agent1')
    expect(updates.agentAutoReply).toBe(false)
  })
})

describe('Conversation PATCH agent fields', () => {
  it('setting assignedAgentId as override', () => {
    const body = { assignedAgentId: 'override-agent' }
    const agentUpdates: Record<string, any> = {}
    if (body.assignedAgentId !== undefined) {
      agentUpdates.assignedAgentId = body.assignedAgentId || null
    }
    expect(agentUpdates.assignedAgentId).toBe('override-agent')
  })

  it('clearing assignedAgentId removes override', () => {
    const body = { assignedAgentId: null }
    const agentUpdates: Record<string, any> = {}
    if (body.assignedAgentId !== undefined) {
      agentUpdates.assignedAgentId = body.assignedAgentId || null
    }
    expect(agentUpdates.assignedAgentId).toBe(null)
  })

  it('agentPaused toggle', () => {
    const u1: Record<string, any> = {}
    const u2: Record<string, any> = {}
    if (({ agentPaused: true }).agentPaused !== undefined) u1.agentPaused = true
    if (({ agentPaused: false }).agentPaused !== undefined) u2.agentPaused = false
    expect(u1.agentPaused).toBe(true)
    expect(u2.agentPaused).toBe(false)
  })

  it('agentHandedOff re-engage', () => {
    const body = { agentHandedOff: false }
    const agentUpdates: Record<string, any> = {}
    if (body.agentHandedOff !== undefined) {
      agentUpdates.agentHandedOff = body.agentHandedOff
    }
    expect(agentUpdates.agentHandedOff).toBe(false)
  })
})

describe('Edge cases', () => {
  it('empty message text should not trigger agent', () => {
    const emptyText = '' as string
    expect(!!emptyText).toBe(false)
  })

  it('media-only WhatsApp message (no text, no caption) should not trigger agent', () => {
    const message = { type: 'image', image: { id: 'img1', mime_type: 'image/jpeg' } }
    const messageText =
      message.type === 'text'
        ? undefined
        : (message as any).image?.caption || (message as any).video?.caption
    expect(!!messageText).toBe(false)
  })

  it('WhatsApp message with caption triggers agent', () => {
    const message = {
      type: 'image',
      image: { id: 'img1', mime_type: 'image/jpeg', caption: 'Check this out' }
    }
    const messageText =
      message.type === 'text'
        ? undefined
        : (message as any).image?.caption || (message as any).video?.caption
    expect(!!messageText).toBe(true)
    expect(messageText).toBe('Check this out')
  })

  it('Instagram text message triggers agent', () => {
    const message = { text: 'Hello', mid: 'mid123' }
    expect(!!(message.text || '')).toBe(true)
  })
})
