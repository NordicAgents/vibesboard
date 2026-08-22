/**
 * Tests for client-side chat completion logic extracted from AgentChat.
 *
 * Covers: checkCompletion (race condition ref, isCorrecting guard,
 *         marker detection) and isNewCollectorConversation.
 */
import { describe, expect, it } from 'vitest'
import {
  checkCompletion,
  isNewCollectorConversation,
} from './chat-completion-check.ts'

// -------------------------------------------------------------------
// 1. isNewCollectorConversation
// -------------------------------------------------------------------
describe('isNewCollectorConversation', () => {
  it('returns true for collector mode with no conversationId and no messages', () => {
    expect(isNewCollectorConversation('collector', undefined, undefined)).toBe(
      true,
    )
  })

  it('returns true for collector mode with empty messages array', () => {
    expect(isNewCollectorConversation('collector', undefined, [])).toBe(true)
  })

  it('returns false for provider mode', () => {
    expect(isNewCollectorConversation('provider', undefined, undefined)).toBe(
      false,
    )
  })

  it('returns false when initialConversationId exists', () => {
    expect(isNewCollectorConversation('collector', 'conv-123', undefined)).toBe(
      false,
    )
  })

  it('returns false when initialMessages has items', () => {
    const messages = [{ id: '1', role: 'assistant' as const, content: 'Hi' }]
    expect(isNewCollectorConversation('collector', undefined, messages)).toBe(
      false,
    )
  })

  it('returns false for undefined mode', () => {
    expect(isNewCollectorConversation(undefined, undefined, undefined)).toBe(
      false,
    )
  })
})

// -------------------------------------------------------------------
// 2. checkCompletion — agent disabled
// -------------------------------------------------------------------
describe('checkCompletion — agent disabled', () => {
  it('completes immediately when agent is disabled', () => {
    const result = checkCompletion({
      messages: [],
      isAgentDisabled: true,
      remainingResponses: null,
      isCorrecting: false,
    })
    expect(result.shouldComplete).toBe(true)
  })
})

// -------------------------------------------------------------------
// 3. checkCompletion — remaining responses (ref-based check)
// -------------------------------------------------------------------
describe('checkCompletion — remaining responses', () => {
  it('completes when remainingResponses is 0', () => {
    const result = checkCompletion({
      messages: [{ id: '1', role: 'assistant', content: 'Normal reply' }],
      isAgentDisabled: false,
      remainingResponses: 0,
      isCorrecting: false,
    })
    expect(result.shouldComplete).toBe(true)
  })

  it('completes when remainingResponses is negative', () => {
    const result = checkCompletion({
      messages: [{ id: '1', role: 'assistant', content: 'Normal reply' }],
      isAgentDisabled: false,
      remainingResponses: -1,
      isCorrecting: false,
    })
    expect(result.shouldComplete).toBe(true)
  })

  it('does NOT complete when remainingResponses is null', () => {
    const result = checkCompletion({
      messages: [{ id: '1', role: 'assistant', content: 'Normal reply' }],
      isAgentDisabled: false,
      remainingResponses: null,
      isCorrecting: false,
    })
    expect(result.shouldComplete).toBe(false)
  })

  it('does NOT complete when remainingResponses > 0', () => {
    const result = checkCompletion({
      messages: [{ id: '1', role: 'assistant', content: 'Normal reply' }],
      isAgentDisabled: false,
      remainingResponses: 3,
      isCorrecting: false,
    })
    expect(result.shouldComplete).toBe(false)
  })
})

// -------------------------------------------------------------------
// 4. checkCompletion — isCorrecting guard
// -------------------------------------------------------------------
describe('checkCompletion — isCorrecting guard', () => {
  it('skips remaining-responses check when isCorrecting is true', () => {
    const result = checkCompletion({
      messages: [{ id: '1', role: 'assistant', content: 'Normal reply' }],
      isAgentDisabled: false,
      remainingResponses: 0,
      isCorrecting: true,
    })
    // Should NOT complete — correction flow bypasses remaining-responses
    expect(result.shouldComplete).toBe(false)
  })

  it('isCorrecting does not bypass agent-disabled check', () => {
    const result = checkCompletion({
      messages: [],
      isAgentDisabled: true,
      remainingResponses: 0,
      isCorrecting: true,
    })
    expect(result.shouldComplete).toBe(true)
  })

  it('isCorrecting is cleared when LLM emits a completion marker', () => {
    const result = checkCompletion({
      messages: [
        { id: '1', role: 'assistant', content: 'Done! [COLLECTION_COMPLETE]' },
      ],
      isAgentDisabled: false,
      remainingResponses: 0,
      isCorrecting: true,
    })
    expect(result.shouldComplete).toBe(true)
    expect(result.shouldClearCorrecting).toBe(true)
  })
})

// -------------------------------------------------------------------
// 5. checkCompletion — completion markers
// -------------------------------------------------------------------
describe('checkCompletion — completion markers', () => {
  it('detects [COLLECTION_COMPLETE]', () => {
    const result = checkCompletion({
      messages: [
        { id: '1', role: 'assistant', content: 'Thanks! [COLLECTION_COMPLETE]' },
      ],
      isAgentDisabled: false,
      remainingResponses: null,
      isCorrecting: false,
    })
    expect(result.shouldComplete).toBe(true)
    expect(result.shouldClearCorrecting).toBe(true)
  })

  it('detects [INFO_COMPLETE]', () => {
    const result = checkCompletion({
      messages: [
        { id: '1', role: 'assistant', content: 'All done. [INFO_COMPLETE]' },
      ],
      isAgentDisabled: false,
      remainingResponses: null,
      isCorrecting: false,
    })
    expect(result.shouldComplete).toBe(true)
    expect(result.shouldClearCorrecting).toBe(true)
  })

  it('detects CHAT_COMPLETE HTML marker', () => {
    const result = checkCompletion({
      messages: [
        {
          id: '1',
          role: 'assistant',
          content:
            'Done <!--CHAT_COMPLETE:{"chatComplete":true,"reason":"collection_complete"}-->',
        },
      ],
      isAgentDisabled: false,
      remainingResponses: null,
      isCorrecting: false,
    })
    expect(result.shouldComplete).toBe(true)
    expect(result.shouldClearCorrecting).toBe(true)
  })

  it('does NOT complete for CHAT_COMPLETE with chatComplete:false (handoff)', () => {
    const result = checkCompletion({
      messages: [
        {
          id: '1',
          role: 'assistant',
          content:
            'Handing off <!--CHAT_COMPLETE:{"chatComplete":false,"reason":"handoff_to_agent"}-->',
        },
      ],
      isAgentDisabled: false,
      remainingResponses: null,
      isCorrecting: false,
    })
    expect(result.shouldComplete).toBe(false)
  })

  it('checks only the last assistant message', () => {
    const result = checkCompletion({
      messages: [
        { id: '1', role: 'assistant', content: '[COLLECTION_COMPLETE]' },
        { id: '2', role: 'user', content: 'Thanks' },
        { id: '3', role: 'assistant', content: 'You are welcome!' },
      ],
      isAgentDisabled: false,
      remainingResponses: null,
      isCorrecting: false,
    })
    // Last assistant is "You are welcome!" — no marker
    expect(result.shouldComplete).toBe(false)
  })

  it('does not complete when no messages', () => {
    const result = checkCompletion({
      messages: [],
      isAgentDisabled: false,
      remainingResponses: null,
      isCorrecting: false,
    })
    expect(result.shouldComplete).toBe(false)
  })

  it('does not complete when last message is from user', () => {
    const result = checkCompletion({
      messages: [
        { id: '1', role: 'assistant', content: 'Hello' },
        { id: '2', role: 'user', content: 'Hi back' },
      ],
      isAgentDisabled: false,
      remainingResponses: null,
      isCorrecting: false,
    })
    expect(result.shouldComplete).toBe(false)
  })
})
