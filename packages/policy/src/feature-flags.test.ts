import { describe, it, expect } from 'vitest'
import {
  FEATURE_FLAG_NAMES,
  FEATURE_FLAG_HIERARCHY,
  getParentFlag,
  getChildFlags,
  getAllDescendants,
  getFlagDepth,
  getRootAncestor,
} from './feature-flags.ts'

describe('feature-flags: hierarchy integrity', () => {
  it('every hierarchy key and value is a known flag name', () => {
    const known = new Set<string>(FEATURE_FLAG_NAMES)
    for (const [child, parent] of Object.entries(FEATURE_FLAG_HIERARCHY)) {
      expect(known.has(child)).toBe(true)
      expect(known.has(parent as string)).toBe(true)
    }
  })

  it('has no cycles (walking parents always terminates at a root)', () => {
    for (const flag of FEATURE_FLAG_NAMES) {
      // getRootAncestor loops on parent links; a cycle would hang. Bound it.
      const root = getRootAncestor(flag)
      expect(getParentFlag(root)).toBe(null)
    }
  })
})

describe('feature-flags: getParentFlag', () => {
  it('returns the parent for a child flag', () => {
    expect(getParentFlag('WHATSAPP_INBOX')).toBe('INBOX')
    expect(getParentFlag('WHATSAPP_INBOX_OAUTH')).toBe('WHATSAPP_INBOX')
  })

  it('returns null for a root flag', () => {
    expect(getParentFlag('INBOX')).toBe(null)
    expect(getParentFlag('CUSTOM_BRANDING')).toBe(null)
  })
})

describe('feature-flags: getChildFlags', () => {
  it('returns direct children only (not grandchildren)', () => {
    const children = getChildFlags('INBOX').sort()
    expect(children).toEqual(['INSTAGRAM_INBOX', 'WHATSAPP_INBOX'])
    // OAUTH variants are grandchildren, not direct children of INBOX.
    expect(children).not.toContain('WHATSAPP_INBOX_OAUTH')
  })

  it('returns an empty array for a leaf flag', () => {
    expect(getChildFlags('WHATSAPP_INBOX_OAUTH')).toEqual([])
    expect(getChildFlags('CUSTOM_BRANDING')).toEqual([])
  })
})

describe('feature-flags: getAllDescendants', () => {
  it('recursively collects children and grandchildren', () => {
    const all = getAllDescendants('INBOX').sort()
    expect(all).toEqual(
      [
        'INSTAGRAM_INBOX',
        'INSTAGRAM_INBOX_API_KEY',
        'INSTAGRAM_INBOX_BYOA',
        'INSTAGRAM_INBOX_OAUTH',
        'WHATSAPP_INBOX',
        'WHATSAPP_INBOX_API_KEY',
        'WHATSAPP_INBOX_BYOA',
        'WHATSAPP_INBOX_OAUTH',
      ].sort(),
    )
  })

  it('returns an empty array for a leaf flag', () => {
    expect(getAllDescendants('AGENT_ACTIONS')).toEqual([])
  })

  it('one level deep for a flag with only direct children', () => {
    // AGENT_NOTIFICATIONS has 3 direct children, none of which have children.
    expect(getAllDescendants('AGENT_NOTIFICATIONS').sort()).toEqual(
      [
        'AGENT_NOTIFICATIONS_EMAIL',
        'AGENT_NOTIFICATIONS_INAPP',
        'AGENT_NOTIFICATIONS_WEBHOOK',
      ].sort(),
    )
  })
})

describe('feature-flags: getFlagDepth', () => {
  it('root flags have depth 0', () => {
    expect(getFlagDepth('INBOX')).toBe(0)
    expect(getFlagDepth('CUSTOM_BRANDING')).toBe(0)
  })

  it('direct children have depth 1', () => {
    expect(getFlagDepth('WHATSAPP_INBOX')).toBe(1)
    expect(getFlagDepth('AGENT_NOTIFICATIONS_EMAIL')).toBe(1)
  })

  it('grandchildren have depth 2', () => {
    expect(getFlagDepth('WHATSAPP_INBOX_OAUTH')).toBe(2)
    expect(getFlagDepth('INSTAGRAM_INBOX_BYOA')).toBe(2)
  })
})

describe('feature-flags: getRootAncestor', () => {
  it('returns the flag itself when it is a root', () => {
    expect(getRootAncestor('INBOX')).toBe('INBOX')
    expect(getRootAncestor('AGENT_ACTIONS')).toBe('AGENT_ACTIONS')
  })

  it('walks up multiple levels to the topmost ancestor', () => {
    expect(getRootAncestor('WHATSAPP_INBOX_OAUTH')).toBe('INBOX')
    expect(getRootAncestor('INSTAGRAM_INBOX_API_KEY')).toBe('INBOX')
    expect(getRootAncestor('AGENT_NOTIFICATIONS_WEBHOOK')).toBe(
      'AGENT_NOTIFICATIONS',
    )
  })
})
