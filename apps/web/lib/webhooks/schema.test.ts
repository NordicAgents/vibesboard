// MEDIUM: the webhook zod schemas are the input-validation gate for inbound
// Meta webhook routes — malformed payloads/verification queries must be
// rejected before any handler runs.
import { describe, it, expect } from 'vitest'
import {
  WebhookPayloadSchema,
  WebhookVerificationSchema
} from './schema.ts'

describe('WebhookVerificationSchema', () => {
  it('accepts a complete verification query', () => {
    const result = WebhookVerificationSchema.safeParse({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'token',
      'hub.challenge': '12345'
    })
    expect(result.success).toBeTruthy()
  })

  it('rejects a query missing hub.challenge', () => {
    const result = WebhookVerificationSchema.safeParse({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'token'
    })
    expect(result.success).toBe(false)
  })
})

describe('WebhookPayloadSchema', () => {
  it('accepts a well-formed payload', () => {
    const result = WebhookPayloadSchema.safeParse({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'wba-1',
          time: 1700000000,
          changes: [{ field: 'messages', value: { messages: [] } }]
        }
      ]
    })
    expect(result.success).toBeTruthy()
  })

  it('accepts an entry without the optional changes array', () => {
    const result = WebhookPayloadSchema.safeParse({
      object: 'x',
      entry: [{ id: 'e1', time: 1 }]
    })
    expect(result.success).toBeTruthy()
  })

  it('accepts an empty entry array', () => {
    expect(
      WebhookPayloadSchema.safeParse({ object: 'x', entry: [] }).success
    ).toBeTruthy()
  })

  it('rejects a payload missing object', () => {
    expect(WebhookPayloadSchema.safeParse({ entry: [] }).success).toBe(false)
  })

  it('rejects a payload where entry is not an array', () => {
    expect(
      WebhookPayloadSchema.safeParse({ object: 'x', entry: {} }).success
    ).toBe(false)
  })

  it('rejects an entry missing its required id', () => {
    expect(
      WebhookPayloadSchema.safeParse({
        object: 'x',
        entry: [{ time: 1 }]
      }).success
    ).toBe(false)
  })

  it('rejects an entry missing its required time', () => {
    expect(
      WebhookPayloadSchema.safeParse({
        object: 'x',
        entry: [{ id: 'e1' }]
      }).success
    ).toBe(false)
  })
})
