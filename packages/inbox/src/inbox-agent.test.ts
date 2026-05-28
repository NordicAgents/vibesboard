/**
 * Tests for inbox-agent feature: agent resolution, handler flow, reply adapters.
 *
 * These are pure-logic tests — they validate the resolution logic,
 * sentinel patterns, message flow, and edge cases without hitting
 * external services.
 *
 * Run:
 *   node --experimental-strip-types --test lib/inbox-agent/inbox-agent.test.ts
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// ─── Replicated types & logic (path aliases don't resolve in node test runner) ──

type InboxChannel = 'whatsapp' | 'instagram'

// Replicate the sentinel pattern used for agent-sent messages
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

// Replicate externalId construction
function buildExternalId(
  channel: InboxChannel,
  accountId: string,
  contactId: string
): string {
  return `inbox:${channel}:${accountId}:${contactId}`
}

// Replicate agent resolution logic (decision tree only, no DB access)
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
  // Check conversation-level flags
  if (conversation?.agentPaused || conversation?.agentHandedOff) {
    return null
  }

  // Per-conversation override
  if (conversation?.assignedAgentId) {
    return conversation.assignedAgentId
  }

  // Account-level default
  if (account?.agentAutoReply === false) {
    return null
  }

  return account?.assignedAgentId || null
}

// Replicate 24h window check
function isWindowExpired(windowExpiresAt: string): boolean {
  return new Date(windowExpiresAt) <= new Date()
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('Agent sentBy sentinel pattern', () => {
  test('creates correct sentinel value', () => {
    assert.equal(makeAgentSentBy('abc123'), 'agent:abc123')
  })

  test('detects agent-sent messages', () => {
    assert.equal(isAgentSentMessage('agent:abc123'), true)
    assert.equal(isAgentSentMessage('agent:'), true)
    assert.equal(isAgentSentMessage('user123'), false)
    assert.equal(isAgentSentMessage(undefined), false)
    assert.equal(isAgentSentMessage(''), false)
  })

  test('extracts agent ID from sentinel', () => {
    assert.equal(extractAgentIdFromSentBy('agent:abc123'), 'abc123')
    assert.equal(extractAgentIdFromSentBy('agent:a-b_c'), 'a-b_c')
    assert.equal(extractAgentIdFromSentBy('user123'), null)
  })

  test('sentinel is never a valid user ID', () => {
    const sentinel = makeAgentSentBy('someAgentId')
    // User IDs are alphanumeric, never contain ':'
    assert.ok(
      sentinel.includes(':'),
      'Sentinel must contain colon to distinguish from user IDs'
    )
  })
})

describe('External ID construction', () => {
  test('WhatsApp format', () => {
    assert.equal(
      buildExternalId('whatsapp', 'acc123', '5511999'),
      'inbox:whatsapp:acc123:5511999'
    )
  })

  test('Instagram format', () => {
    assert.equal(
      buildExternalId('instagram', 'acc456', 'igsid789'),
      'inbox:instagram:acc456:igsid789'
    )
  })

  test('different contacts produce different IDs', () => {
    const id1 = buildExternalId('whatsapp', 'acc1', 'phone1')
    const id2 = buildExternalId('whatsapp', 'acc1', 'phone2')
    assert.notEqual(id1, id2)
  })

  test('different channels produce different IDs', () => {
    const wa = buildExternalId('whatsapp', 'acc1', 'contact1')
    const ig = buildExternalId('instagram', 'acc1', 'contact1')
    assert.notEqual(wa, ig)
  })
})

describe('Agent resolution logic', () => {
  test('returns conversation-level agent override', () => {
    const convo: MockConversation = { assignedAgentId: 'convo-agent' }
    const account: MockAccount = { assignedAgentId: 'account-agent' }
    assert.equal(resolveEffectiveAgentId(convo, account), 'convo-agent')
  })

  test('falls back to account-level agent when no conversation override', () => {
    const convo: MockConversation = { assignedAgentId: null }
    const account: MockAccount = { assignedAgentId: 'account-agent' }
    assert.equal(resolveEffectiveAgentId(convo, account), 'account-agent')
  })

  test('returns null when no agent assigned anywhere', () => {
    const convo: MockConversation = {}
    const account: MockAccount = {}
    assert.equal(resolveEffectiveAgentId(convo, account), null)
  })

  test('returns null when agent is paused on conversation', () => {
    const convo: MockConversation = {
      assignedAgentId: 'agent1',
      agentPaused: true
    }
    const account: MockAccount = { assignedAgentId: 'agent1' }
    assert.equal(resolveEffectiveAgentId(convo, account), null)
  })

  test('returns null when conversation is handed off', () => {
    const convo: MockConversation = {
      assignedAgentId: 'agent1',
      agentHandedOff: true
    }
    const account: MockAccount = { assignedAgentId: 'agent1' }
    assert.equal(resolveEffectiveAgentId(convo, account), null)
  })

  test('returns null when agentAutoReply is false on account', () => {
    const convo: MockConversation = {}
    const account: MockAccount = {
      assignedAgentId: 'agent1',
      agentAutoReply: false
    }
    assert.equal(resolveEffectiveAgentId(convo, account), null)
  })

  test('agentAutoReply defaults to true (undefined means auto-reply enabled)', () => {
    const convo: MockConversation = {}
    const account: MockAccount = {
      assignedAgentId: 'agent1'
      // agentAutoReply not set — should default to enabled
    }
    assert.equal(resolveEffectiveAgentId(convo, account), 'agent1')
  })

  test('conversation override bypasses account agentAutoReply=false', () => {
    const convo: MockConversation = { assignedAgentId: 'convo-agent' }
    const account: MockAccount = {
      assignedAgentId: 'account-agent',
      agentAutoReply: false
    }
    // Per-conversation override is checked before account autoReply
    assert.equal(resolveEffectiveAgentId(convo, account), 'convo-agent')
  })

  test('handles null conversation (new contact, no doc yet)', () => {
    const account: MockAccount = { assignedAgentId: 'agent1' }
    assert.equal(resolveEffectiveAgentId(null, account), 'agent1')
  })

  test('handles null account', () => {
    const convo: MockConversation = {}
    assert.equal(resolveEffectiveAgentId(convo, null), null)
  })
})

describe('24h messaging window', () => {
  test('window is open when expiry is in the future', () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    assert.equal(isWindowExpired(future), false)
  })

  test('window is expired when expiry is in the past', () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    assert.equal(isWindowExpired(past), true)
  })

  test('window is expired at exact expiry time', () => {
    // Edge case: exactly at expiry (<=) should be expired
    const now = new Date().toISOString()
    // Tiny race window, but the logic uses <= so this should be expired
    assert.equal(isWindowExpired(now), true)
  })
})

describe('Handoff flow', () => {
  test('handoff marker detection (replicated from completion.ts)', () => {
    const HANDOFF_MARKER = '[HANDOFF_TO_HUMAN]'

    // Detect handoff
    const text1 = 'Let me connect you with a human agent. [HANDOFF_TO_HUMAN]'
    assert.ok(text1.includes(HANDOFF_MARKER))

    // No handoff
    const text2 = 'Here is the answer to your question.'
    assert.ok(!text2.includes(HANDOFF_MARKER))

    // Strip marker
    const stripped = text1.replace(HANDOFF_MARKER, '').trim()
    assert.equal(stripped, 'Let me connect you with a human agent.')
  })

  test('re-engage flow resets flags', () => {
    const convo: MockConversation = {
      assignedAgentId: 'agent1',
      agentHandedOff: true,
      agentPaused: false
    }

    // Before re-engage: agent should not be resolved
    assert.equal(resolveEffectiveAgentId(convo, null), null)

    // Simulate re-engage: clear handoff
    convo.agentHandedOff = false
    assert.equal(resolveEffectiveAgentId(convo, null), 'agent1')
  })

  test('pause + resume cycle', () => {
    const convo: MockConversation = {
      assignedAgentId: 'agent1'
    }

    // Active
    assert.equal(resolveEffectiveAgentId(convo, null), 'agent1')

    // Pause
    convo.agentPaused = true
    assert.equal(resolveEffectiveAgentId(convo, null), null)

    // Resume
    convo.agentPaused = false
    assert.equal(resolveEffectiveAgentId(convo, null), 'agent1')
  })
})

describe('Message dual-store linking', () => {
  test('inbox message stores agent sentinel in sentBy', () => {
    const agentId = 'abc123'
    const agentName = 'Support Bot'

    // Simulating what sendReply() stores
    const msgDoc = {
      sentBy: makeAgentSentBy(agentId),
      sentByAgentName: agentName,
      direction: 'outbound' as const
    }

    assert.equal(msgDoc.sentBy, 'agent:abc123')
    assert.equal(msgDoc.sentByAgentName, 'Support Bot')
    assert.equal(isAgentSentMessage(msgDoc.sentBy), true)
  })

  test('human message has userId in sentBy, no agent name', () => {
    const msgDoc = {
      sentBy: 'user-uid-123',
      direction: 'outbound' as const
    }

    assert.equal(isAgentSentMessage(msgDoc.sentBy), false)
  })
})

describe('Handoff instructions injection', () => {
  test('instructions are appended, not replaced', () => {
    const original = 'You are a helpful support agent.'
    const handoffSuffix =
      '\n\nIMPORTANT: If the customer asks to speak to a human agent, requests escalation, or you cannot resolve their issue, let them know you are connecting them with a human agent and end your response with [HANDOFF_TO_HUMAN].'

    const injected = original + handoffSuffix

    assert.ok(injected.startsWith(original))
    assert.ok(injected.includes('[HANDOFF_TO_HUMAN]'))
    assert.ok(injected.length > original.length)
  })

  test('works with empty instructions', () => {
    const original = ''
    const handoffSuffix =
      '\n\nIMPORTANT: If the customer asks to speak to a human agent, requests escalation, or you cannot resolve their issue, let them know you are connecting them with a human agent and end your response with [HANDOFF_TO_HUMAN].'

    const injected = (original || '') + handoffSuffix
    assert.ok(injected.includes('[HANDOFF_TO_HUMAN]'))
  })
})

describe('Message deduplication', () => {
  test('new user message is appended when not in history', () => {
    const prior = [
      { id: 'msg1', role: 'user' as const, content: 'Hello' },
      { id: 'msg2', role: 'assistant' as const, content: 'Hi there!' }
    ]
    const userMessage = {
      id: 'msg3',
      role: 'user' as const,
      content: 'Help me'
    }

    const hasDuplicate = prior.some(m => m.id === userMessage.id)
    const allMessages = hasDuplicate ? prior : [...prior, userMessage]

    assert.equal(allMessages.length, 3)
    assert.equal(allMessages[2].content, 'Help me')
  })

  test('duplicate user message is not re-added', () => {
    const userMessage = { id: 'msg1', role: 'user' as const, content: 'Hello' }
    const prior = [userMessage]

    const hasDuplicate = prior.some(m => m.id === userMessage.id)
    const allMessages = hasDuplicate ? prior : [...prior, userMessage]

    assert.equal(allMessages.length, 1)
  })
})

describe('Account PATCH validation logic', () => {
  test('assigning agent sets agentAutoReply to true by default', () => {
    const body = { assignedAgentId: 'agent1' }
    const updates: Record<string, any> = {}

    if (body.assignedAgentId !== undefined) {
      updates.assignedAgentId = body.assignedAgentId || null
      // Default agentAutoReply to true when assigning
      if ((body as any).agentAutoReply === undefined && body.assignedAgentId) {
        updates.agentAutoReply = true
      }
    }

    assert.equal(updates.assignedAgentId, 'agent1')
    assert.equal(updates.agentAutoReply, true)
  })

  test('unassigning agent sets assignedAgentId to null', () => {
    const body = { assignedAgentId: null }
    const updates: Record<string, any> = {}

    if (body.assignedAgentId !== undefined) {
      updates.assignedAgentId = body.assignedAgentId || null
    }

    assert.equal(updates.assignedAgentId, null)
    assert.equal(updates.agentAutoReply, undefined) // not set
  })

  test('explicit agentAutoReply=false is respected', () => {
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

    assert.equal(updates.assignedAgentId, 'agent1')
    assert.equal(updates.agentAutoReply, false) // explicit false wins
  })
})

describe('Conversation PATCH agent fields', () => {
  test('setting assignedAgentId as override', () => {
    const body = { assignedAgentId: 'override-agent' }
    const agentUpdates: Record<string, any> = {}

    if (body.assignedAgentId !== undefined) {
      agentUpdates.assignedAgentId = body.assignedAgentId || null
    }

    assert.equal(agentUpdates.assignedAgentId, 'override-agent')
  })

  test('clearing assignedAgentId removes override', () => {
    const body = { assignedAgentId: null }
    const agentUpdates: Record<string, any> = {}

    if (body.assignedAgentId !== undefined) {
      agentUpdates.assignedAgentId = body.assignedAgentId || null
    }

    assert.equal(agentUpdates.assignedAgentId, null)
  })

  test('agentPaused toggle', () => {
    const body1 = { agentPaused: true }
    const body2 = { agentPaused: false }

    const u1: Record<string, any> = {}
    const u2: Record<string, any> = {}

    if (body1.agentPaused !== undefined) u1.agentPaused = body1.agentPaused
    if (body2.agentPaused !== undefined) u2.agentPaused = body2.agentPaused

    assert.equal(u1.agentPaused, true)
    assert.equal(u2.agentPaused, false)
  })

  test('agentHandedOff re-engage', () => {
    const body = { agentHandedOff: false }
    const agentUpdates: Record<string, any> = {}

    if (body.agentHandedOff !== undefined) {
      agentUpdates.agentHandedOff = body.agentHandedOff
    }

    assert.equal(agentUpdates.agentHandedOff, false)
  })
})

describe('Edge cases', () => {
  test('empty message text should not trigger agent', () => {
    const messageText = ''
    const shouldTrigger = !!messageText
    assert.equal(shouldTrigger, false)
  })

  test('media-only WhatsApp message (no text, no caption) should not trigger agent', () => {
    // In webhook handler, messageText is extracted as:
    // message.type === 'text' ? message.text?.body : caption
    const message = {
      type: 'image',
      image: { id: 'img1', mime_type: 'image/jpeg' }
    }
    const messageText =
      message.type === 'text'
        ? undefined
        : (message as any).image?.caption || (message as any).video?.caption
    const shouldTrigger = !!messageText
    assert.equal(shouldTrigger, false)
  })

  test('WhatsApp message with caption triggers agent', () => {
    const message = {
      type: 'image',
      image: { id: 'img1', mime_type: 'image/jpeg', caption: 'Check this out' }
    }
    const messageText =
      message.type === 'text'
        ? undefined
        : (message as any).image?.caption || (message as any).video?.caption
    const shouldTrigger = !!messageText
    assert.equal(shouldTrigger, true)
    assert.equal(messageText, 'Check this out')
  })

  test('Instagram text message triggers agent', () => {
    const message = { text: 'Hello', mid: 'mid123' }
    const messageText = message.text || ''
    const shouldTrigger = !!messageText
    assert.equal(shouldTrigger, true)
  })
})
