/**
 * Integration tests for schema validation changes.
 *
 * Schemas are replicated inline to match @vibesboard/agents/schema exactly
 * (the source module is not importable in a node test environment).
 */
import { describe, it, expect } from 'vitest'
import { z } from 'zod'

const agentChatMessageSchema = z.object({
  id: z.string().optional(),
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().max(2_000)
})

const agentChatRequestSchema = z.object({
  messages: z.array(agentChatMessageSchema).max(100),
  conversationId: z.string().min(1).optional(),
  handoffAgentId: z.string().min(1).optional()
})

const agentAskRequestSchema = z.object({
  question: z.string().min(1).max(2_000),
  contextConversationId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional()
})

describe('agentChatMessageSchema', () => {
  it('accepts valid user message', () => {
    expect(
      agentChatMessageSchema.safeParse({ role: 'user', content: 'Hello' })
        .success
    ).toBeTruthy()
  })

  it('accepts valid assistant message', () => {
    expect(
      agentChatMessageSchema.safeParse({
        role: 'assistant',
        content: 'Hi there'
      }).success
    ).toBeTruthy()
  })

  it('accepts valid system message', () => {
    expect(
      agentChatMessageSchema.safeParse({
        role: 'system',
        content: 'You are helpful.'
      }).success
    ).toBeTruthy()
  })

  it('accepts message with optional id', () => {
    expect(
      agentChatMessageSchema.safeParse({
        id: 'msg-123',
        role: 'user',
        content: 'Hello'
      }).success
    ).toBeTruthy()
  })

  it('rejects content longer than 2000 chars', () => {
    expect(
      agentChatMessageSchema.safeParse({
        role: 'user',
        content: 'x'.repeat(2001)
      }).success
    ).toBe(false)
  })

  it('accepts content at exactly 2000 chars', () => {
    expect(
      agentChatMessageSchema.safeParse({
        role: 'user',
        content: 'x'.repeat(2000)
      }).success
    ).toBeTruthy()
  })

  it('rejects invalid role', () => {
    expect(
      agentChatMessageSchema.safeParse({ role: 'tool', content: 'Hello' })
        .success
    ).toBe(false)
  })

  it('rejects missing content', () => {
    expect(agentChatMessageSchema.safeParse({ role: 'user' }).success).toBe(
      false
    )
  })
})

describe('agentChatRequestSchema', () => {
  it('accepts valid request with one message', () => {
    expect(
      agentChatRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'Hello' }]
      }).success
    ).toBeTruthy()
  })

  it('accepts request with 100 messages', () => {
    const messages = Array.from({ length: 100 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}`
    }))
    expect(agentChatRequestSchema.safeParse({ messages }).success).toBeTruthy()
  })

  it('rejects request with 101 messages', () => {
    const messages = Array.from({ length: 101 }, (_, i) => ({
      role: 'user',
      content: `Message ${i}`
    }))
    expect(agentChatRequestSchema.safeParse({ messages }).success).toBe(false)
  })

  it('allows an empty messages array (no min set)', () => {
    expect(
      agentChatRequestSchema.safeParse({ messages: [] }).success
    ).toBeTruthy()
  })

  it('accepts optional conversationId', () => {
    expect(
      agentChatRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'Hi' }],
        conversationId: 'conv-abc'
      }).success
    ).toBeTruthy()
  })

  it('rejects empty conversationId', () => {
    expect(
      agentChatRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'Hi' }],
        conversationId: ''
      }).success
    ).toBe(false)
  })

  it('propagates message content length validation', () => {
    expect(
      agentChatRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'a'.repeat(2001) }]
      }).success
    ).toBe(false)
  })
})

describe('agentAskRequestSchema', () => {
  it('accepts valid question', () => {
    expect(
      agentAskRequestSchema.safeParse({
        question: 'How many conversations this week?'
      }).success
    ).toBeTruthy()
  })

  it('rejects empty question', () => {
    expect(agentAskRequestSchema.safeParse({ question: '' }).success).toBe(
      false
    )
  })

  it('rejects question longer than 2000 chars', () => {
    expect(
      agentAskRequestSchema.safeParse({ question: 'q'.repeat(2001) }).success
    ).toBe(false)
  })

  it('accepts question at exactly 2000 chars', () => {
    expect(
      agentAskRequestSchema.safeParse({ question: 'q'.repeat(2000) }).success
    ).toBeTruthy()
  })

  it('accepts optional contextConversationId', () => {
    expect(
      agentAskRequestSchema.safeParse({
        question: 'Hello',
        contextConversationId: 'cid-123'
      }).success
    ).toBeTruthy()
  })

  it('accepts optional UUID sessionId', () => {
    expect(
      agentAskRequestSchema.safeParse({
        question: 'Hello',
        sessionId: '550e8400-e29b-41d4-a716-446655440000'
      }).success
    ).toBeTruthy()
  })

  it('accepts non-UUID sessionId (legacy auto-IDs)', () => {
    expect(
      agentAskRequestSchema.safeParse({
        question: 'Hello',
        sessionId: 'abc123legacyId'
      }).success
    ).toBeTruthy()
  })

  it('rejects empty sessionId', () => {
    expect(
      agentAskRequestSchema.safeParse({ question: 'Hello', sessionId: '' })
        .success
    ).toBe(false)
  })
})
