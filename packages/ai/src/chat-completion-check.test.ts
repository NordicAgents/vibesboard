/**
 * Tests for client-side chat completion logic extracted from AgentChat.
 *
 * Covers: checkCompletion (race condition ref, isCorrecting guard,
 *         marker detection) and isNewCollectorConversation.
 *
 * Run:
 *   node --experimental-strip-types --test lib/agent/chat-completion-check.test.ts
 */
import { test, describe } from 'node:test'
import assert from 'node:assert'
import {
  checkCompletion,
  isNewCollectorConversation
} from './chat-completion-check.ts'

// -------------------------------------------------------------------
// 1. isNewCollectorConversation
// -------------------------------------------------------------------
describe('isNewCollectorConversation', () => {
  test('returns true for collector mode with no conversationId and no messages', () => {
    assert.strictEqual(
      isNewCollectorConversation('collector', undefined, undefined),
      true
    )
  })

  test('returns true for collector mode with empty messages array', () => {
    assert.strictEqual(
      isNewCollectorConversation('collector', undefined, []),
      true
    )
  })

  test('returns false for provider mode', () => {
    assert.strictEqual(
      isNewCollectorConversation('provider', undefined, undefined),
      false
    )
  })

  test('returns false when initialConversationId exists', () => {
    assert.strictEqual(
      isNewCollectorConversation('collector', 'conv-123', undefined),
      false
    )
  })

  test('returns false when initialMessages has items', () => {
    const messages = [{ id: '1', role: 'assistant' as const, content: 'Hi' }]
    assert.strictEqual(
      isNewCollectorConversation('collector', undefined, messages),
      false
    )
  })

  test('returns false for undefined mode', () => {
    assert.strictEqual(
      isNewCollectorConversation(undefined, undefined, undefined),
      false
    )
  })
})

// -------------------------------------------------------------------
// 2. checkCompletion — agent disabled
// -------------------------------------------------------------------
describe('checkCompletion — agent disabled', () => {
  test('completes immediately when agent is disabled', () => {
    const result = checkCompletion({
      messages: [],
      isAgentDisabled: true,
      remainingResponses: null,
      isCorrecting: false
    })
    assert.strictEqual(result.shouldComplete, true)
  })
})

// -------------------------------------------------------------------
// 3. checkCompletion — remaining responses (ref-based check)
// -------------------------------------------------------------------
describe('checkCompletion — remaining responses', () => {
  test('completes when remainingResponses is 0', () => {
    const result = checkCompletion({
      messages: [{ id: '1', role: 'assistant', content: 'Normal reply' }],
      isAgentDisabled: false,
      remainingResponses: 0,
      isCorrecting: false
    })
    assert.strictEqual(result.shouldComplete, true)
  })

  test('completes when remainingResponses is negative', () => {
    const result = checkCompletion({
      messages: [{ id: '1', role: 'assistant', content: 'Normal reply' }],
      isAgentDisabled: false,
      remainingResponses: -1,
      isCorrecting: false
    })
    assert.strictEqual(result.shouldComplete, true)
  })

  test('does NOT complete when remainingResponses is null', () => {
    const result = checkCompletion({
      messages: [{ id: '1', role: 'assistant', content: 'Normal reply' }],
      isAgentDisabled: false,
      remainingResponses: null,
      isCorrecting: false
    })
    assert.strictEqual(result.shouldComplete, false)
  })

  test('does NOT complete when remainingResponses > 0', () => {
    const result = checkCompletion({
      messages: [{ id: '1', role: 'assistant', content: 'Normal reply' }],
      isAgentDisabled: false,
      remainingResponses: 3,
      isCorrecting: false
    })
    assert.strictEqual(result.shouldComplete, false)
  })
})

// -------------------------------------------------------------------
// 4. checkCompletion — isCorrecting guard
// -------------------------------------------------------------------
describe('checkCompletion — isCorrecting guard', () => {
  test('skips remaining-responses check when isCorrecting is true', () => {
    const result = checkCompletion({
      messages: [{ id: '1', role: 'assistant', content: 'Normal reply' }],
      isAgentDisabled: false,
      remainingResponses: 0,
      isCorrecting: true
    })
    // Should NOT complete — correction flow bypasses remaining-responses
    assert.strictEqual(result.shouldComplete, false)
  })

  test('isCorrecting does not bypass agent-disabled check', () => {
    const result = checkCompletion({
      messages: [],
      isAgentDisabled: true,
      remainingResponses: 0,
      isCorrecting: true
    })
    assert.strictEqual(result.shouldComplete, true)
  })

  test('isCorrecting is cleared when LLM emits a completion marker', () => {
    const result = checkCompletion({
      messages: [
        { id: '1', role: 'assistant', content: 'Done! [COLLECTION_COMPLETE]' }
      ],
      isAgentDisabled: false,
      remainingResponses: 0,
      isCorrecting: true
    })
    assert.strictEqual(result.shouldComplete, true)
    assert.strictEqual(result.shouldClearCorrecting, true)
  })
})

// -------------------------------------------------------------------
// 5. checkCompletion — completion markers
// -------------------------------------------------------------------
describe('checkCompletion — completion markers', () => {
  test('detects [COLLECTION_COMPLETE]', () => {
    const result = checkCompletion({
      messages: [
        { id: '1', role: 'assistant', content: 'Thanks! [COLLECTION_COMPLETE]' }
      ],
      isAgentDisabled: false,
      remainingResponses: null,
      isCorrecting: false
    })
    assert.strictEqual(result.shouldComplete, true)
    assert.strictEqual(result.shouldClearCorrecting, true)
  })

  test('detects [INFO_COMPLETE]', () => {
    const result = checkCompletion({
      messages: [
        { id: '1', role: 'assistant', content: 'All done. [INFO_COMPLETE]' }
      ],
      isAgentDisabled: false,
      remainingResponses: null,
      isCorrecting: false
    })
    assert.strictEqual(result.shouldComplete, true)
    assert.strictEqual(result.shouldClearCorrecting, true)
  })

  test('detects CHAT_COMPLETE HTML marker', () => {
    const result = checkCompletion({
      messages: [
        {
          id: '1',
          role: 'assistant',
          content:
            'Done <!--CHAT_COMPLETE:{"chatComplete":true,"reason":"collection_complete"}-->'
        }
      ],
      isAgentDisabled: false,
      remainingResponses: null,
      isCorrecting: false
    })
    assert.strictEqual(result.shouldComplete, true)
    assert.strictEqual(result.shouldClearCorrecting, true)
  })

  test('does NOT complete for CHAT_COMPLETE with chatComplete:false (handoff)', () => {
    const result = checkCompletion({
      messages: [
        {
          id: '1',
          role: 'assistant',
          content:
            'Handing off <!--CHAT_COMPLETE:{"chatComplete":false,"reason":"handoff_to_agent"}-->'
        }
      ],
      isAgentDisabled: false,
      remainingResponses: null,
      isCorrecting: false
    })
    assert.strictEqual(result.shouldComplete, false)
  })

  test('checks only the last assistant message', () => {
    const result = checkCompletion({
      messages: [
        { id: '1', role: 'assistant', content: '[COLLECTION_COMPLETE]' },
        { id: '2', role: 'user', content: 'Thanks' },
        { id: '3', role: 'assistant', content: 'You are welcome!' }
      ],
      isAgentDisabled: false,
      remainingResponses: null,
      isCorrecting: false
    })
    // Last assistant is "You are welcome!" — no marker
    assert.strictEqual(result.shouldComplete, false)
  })

  test('does not complete when no messages', () => {
    const result = checkCompletion({
      messages: [],
      isAgentDisabled: false,
      remainingResponses: null,
      isCorrecting: false
    })
    assert.strictEqual(result.shouldComplete, false)
  })

  test('does not complete when last message is from user', () => {
    const result = checkCompletion({
      messages: [
        { id: '1', role: 'assistant', content: 'Hello' },
        { id: '2', role: 'user', content: 'Hi back' }
      ],
      isAgentDisabled: false,
      remainingResponses: null,
      isCorrecting: false
    })
    assert.strictEqual(result.shouldComplete, false)
  })
})
