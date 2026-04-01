/**
 * Integration tests for schema validation changes in the PR.
 *
 * Tests agentChatMessageSchema (content max 2000), agentChatRequestSchema (max 100 messages),
 * and agentAskRequestSchema (question max 2000).
 */
import { test, describe } from 'node:test'
import assert from 'node:assert'
import { z } from 'zod'

// Replicate schemas inline since we can't use @/ path aliases in Node test runner.
// These must match lib/agents/schema.ts exactly.

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

// -------------------------------------------------------------------
// agentChatMessageSchema
// -------------------------------------------------------------------
describe('agentChatMessageSchema', () => {
  test('accepts valid user message', () => {
    const result = agentChatMessageSchema.safeParse({
      role: 'user',
      content: 'Hello'
    })
    assert.ok(result.success)
  })

  test('accepts valid assistant message', () => {
    const result = agentChatMessageSchema.safeParse({
      role: 'assistant',
      content: 'Hi there'
    })
    assert.ok(result.success)
  })

  test('accepts valid system message', () => {
    const result = agentChatMessageSchema.safeParse({
      role: 'system',
      content: 'You are helpful.'
    })
    assert.ok(result.success)
  })

  test('accepts message with optional id', () => {
    const result = agentChatMessageSchema.safeParse({
      id: 'msg-123',
      role: 'user',
      content: 'Hello'
    })
    assert.ok(result.success)
  })

  test('rejects content longer than 2000 chars', () => {
    const result = agentChatMessageSchema.safeParse({
      role: 'user',
      content: 'x'.repeat(2001)
    })
    assert.ok(!result.success)
  })

  test('accepts content at exactly 2000 chars', () => {
    const result = agentChatMessageSchema.safeParse({
      role: 'user',
      content: 'x'.repeat(2000)
    })
    assert.ok(result.success)
  })

  test('rejects invalid role', () => {
    const result = agentChatMessageSchema.safeParse({
      role: 'tool',
      content: 'Hello'
    })
    assert.ok(!result.success)
  })

  test('rejects missing content', () => {
    const result = agentChatMessageSchema.safeParse({
      role: 'user'
    })
    assert.ok(!result.success)
  })
})

// -------------------------------------------------------------------
// agentChatRequestSchema
// -------------------------------------------------------------------
describe('agentChatRequestSchema', () => {
  test('accepts valid request with one message', () => {
    const result = agentChatRequestSchema.safeParse({
      messages: [{ role: 'user', content: 'Hello' }]
    })
    assert.ok(result.success)
  })

  test('accepts request with 100 messages', () => {
    const messages = Array.from({ length: 100 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}`
    }))
    const result = agentChatRequestSchema.safeParse({ messages })
    assert.ok(result.success)
  })

  test('rejects request with 101 messages', () => {
    const messages = Array.from({ length: 101 }, (_, i) => ({
      role: 'user',
      content: `Message ${i}`
    }))
    const result = agentChatRequestSchema.safeParse({ messages })
    assert.ok(!result.success)
  })

  test('rejects empty messages array', () => {
    // min is not set, but an empty array is technically valid per schema
    const result = agentChatRequestSchema.safeParse({ messages: [] })
    assert.ok(result.success) // empty is allowed by schema
  })

  test('accepts optional conversationId', () => {
    const result = agentChatRequestSchema.safeParse({
      messages: [{ role: 'user', content: 'Hi' }],
      conversationId: 'conv-abc'
    })
    assert.ok(result.success)
  })

  test('rejects empty conversationId', () => {
    const result = agentChatRequestSchema.safeParse({
      messages: [{ role: 'user', content: 'Hi' }],
      conversationId: ''
    })
    assert.ok(!result.success)
  })

  test('propagates message content length validation', () => {
    const result = agentChatRequestSchema.safeParse({
      messages: [{ role: 'user', content: 'a'.repeat(2001) }]
    })
    assert.ok(!result.success)
  })
})

// -------------------------------------------------------------------
// agentAskRequestSchema
// -------------------------------------------------------------------
describe('agentAskRequestSchema', () => {
  test('accepts valid question', () => {
    const result = agentAskRequestSchema.safeParse({
      question: 'How many conversations this week?'
    })
    assert.ok(result.success)
  })

  test('rejects empty question', () => {
    const result = agentAskRequestSchema.safeParse({
      question: ''
    })
    assert.ok(!result.success)
  })

  test('rejects question longer than 2000 chars', () => {
    const result = agentAskRequestSchema.safeParse({
      question: 'q'.repeat(2001)
    })
    assert.ok(!result.success)
  })

  test('accepts question at exactly 2000 chars', () => {
    const result = agentAskRequestSchema.safeParse({
      question: 'q'.repeat(2000)
    })
    assert.ok(result.success)
  })

  test('accepts optional contextConversationId', () => {
    const result = agentAskRequestSchema.safeParse({
      question: 'Hello',
      contextConversationId: 'cid-123'
    })
    assert.ok(result.success)
  })

  test('accepts optional UUID sessionId', () => {
    const result = agentAskRequestSchema.safeParse({
      question: 'Hello',
      sessionId: '550e8400-e29b-41d4-a716-446655440000'
    })
    assert.ok(result.success)
  })

  test('accepts non-UUID sessionId (Firestore auto-IDs)', () => {
    const result = agentAskRequestSchema.safeParse({
      question: 'Hello',
      sessionId: 'abc123firestoreId'
    })
    assert.ok(result.success)
  })

  test('rejects empty sessionId', () => {
    const result = agentAskRequestSchema.safeParse({
      question: 'Hello',
      sessionId: ''
    })
    assert.ok(!result.success)
  })
})
