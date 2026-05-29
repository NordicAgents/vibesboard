import { describe, it, expect } from 'vitest'
import { createAgentLinkSchema, updateAgentLinkSchema } from './schema.ts'

const validCreate = () => ({
  slug: 'promo-link',
  agentId: 'agent-123',
  name: 'Promo Link',
  description: 'A description',
})

describe('createAgentLinkSchema', () => {
  it('accepts a fully valid input', () => {
    const parsed = createAgentLinkSchema.parse(validCreate())
    expect(parsed.slug).toBe('promo-link')
    expect(parsed.name).toBe('Promo Link')
  })

  it('accepts input without the optional description', () => {
    const { slug, agentId, name } = validCreate()
    const res = createAgentLinkSchema.safeParse({ slug, agentId, name })
    expect(res.success).toBe(true)
  })

  describe('slug validation', () => {
    it('rejects slugs shorter than 2 chars', () => {
      expect(createAgentLinkSchema.safeParse({ ...validCreate(), slug: 'a' }).success).toBe(false)
    })

    it('accepts a 2-char slug (lower boundary)', () => {
      expect(createAgentLinkSchema.safeParse({ ...validCreate(), slug: 'ab' }).success).toBe(true)
    })

    it('rejects slugs longer than 60 chars', () => {
      expect(
        createAgentLinkSchema.safeParse({ ...validCreate(), slug: 'a'.repeat(61) }).success,
      ).toBe(false)
    })

    it('rejects uppercase letters', () => {
      expect(createAgentLinkSchema.safeParse({ ...validCreate(), slug: 'Promo' }).success).toBe(false)
    })

    it('rejects a leading hyphen', () => {
      expect(createAgentLinkSchema.safeParse({ ...validCreate(), slug: '-promo' }).success).toBe(false)
    })

    it('rejects a trailing hyphen', () => {
      expect(createAgentLinkSchema.safeParse({ ...validCreate(), slug: 'promo-' }).success).toBe(false)
    })

    it('accepts internal hyphens and digits', () => {
      expect(
        createAgentLinkSchema.safeParse({ ...validCreate(), slug: 'promo-2024-spring' }).success,
      ).toBe(true)
    })

    it('rejects spaces and other special characters', () => {
      expect(createAgentLinkSchema.safeParse({ ...validCreate(), slug: 'promo link' }).success).toBe(false)
      expect(createAgentLinkSchema.safeParse({ ...validCreate(), slug: 'promo_link' }).success).toBe(false)
    })
  })

  describe('agentId validation', () => {
    it('rejects an empty agentId', () => {
      expect(createAgentLinkSchema.safeParse({ ...validCreate(), agentId: '' }).success).toBe(false)
    })
  })

  describe('name validation', () => {
    it('rejects a name shorter than 2 chars', () => {
      expect(createAgentLinkSchema.safeParse({ ...validCreate(), name: 'x' }).success).toBe(false)
    })

    it('rejects a name longer than 120 chars', () => {
      expect(
        createAgentLinkSchema.safeParse({ ...validCreate(), name: 'n'.repeat(121) }).success,
      ).toBe(false)
    })
  })

  describe('description validation', () => {
    it('rejects a description longer than 500 chars', () => {
      expect(
        createAgentLinkSchema.safeParse({ ...validCreate(), description: 'd'.repeat(501) }).success,
      ).toBe(false)
    })
  })
})

describe('updateAgentLinkSchema', () => {
  it('accepts an empty object (all fields optional)', () => {
    expect(updateAgentLinkSchema.safeParse({}).success).toBe(true)
  })

  it('accepts a partial update', () => {
    const res = updateAgentLinkSchema.safeParse({ name: 'Renamed', isActive: false })
    expect(res.success).toBe(true)
  })

  it('allows a null description (clearing it)', () => {
    expect(updateAgentLinkSchema.safeParse({ description: null }).success).toBe(true)
  })

  it('still enforces field constraints when provided', () => {
    expect(updateAgentLinkSchema.safeParse({ name: 'x' }).success).toBe(false)
    expect(updateAgentLinkSchema.safeParse({ agentId: '' }).success).toBe(false)
    expect(updateAgentLinkSchema.safeParse({ isActive: 'yes' }).success).toBe(false)
  })
})
