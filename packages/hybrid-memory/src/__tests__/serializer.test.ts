import { describe, it, expect } from 'vitest'
import { randomUUID as uuid } from 'node:crypto'
import { serializeTreeToC } from '../serializer.ts'
import type { HybridMemory } from '../types.ts'

function makeMemory(overrides: Partial<HybridMemory> = {}): HybridMemory {
  return {
    id: uuid(),
    scopeId: 'org-1',
    subScopeId: null,
    scope: 'org',
    key: '/prefs/style',
    description: 'Test memory',
    content: 'User prefers concise responses',
    category: 'preference',
    presenceClass: 'omnipresent',
    triggerPatterns: [],
    importance: 0.7,
    surprise: 0,
    accessCount: 0,
    lastAccessed: new Date(),
    version: 1,
    createdAt: new Date(),
    ...overrides,
  }
}

describe('serializeTreeToC', () => {
  it('renders omnipresent bodies and non-omnipresent descriptions', () => {
    const output = serializeTreeToC([
      makeMemory({ key: '/prefs/style', content: 'Be concise.' }),
      makeMemory({ key: '/prefs/tone', presenceClass: 'on-demand', description: 'Tone notes' }),
    ])
    expect(output).toContain('[/prefs/style] Be concise.')
    expect(output).toContain('[/prefs/tone] Tone notes ...')
  })

  it('tocOnly renders descriptions instead of omnipresent bodies', () => {
    const output = serializeTreeToC(
      [makeMemory({ content: 'Full body text', description: 'ToC label' })],
      { tocOnly: true },
    )
    expect(output).not.toContain('Full body text')
    expect(output).toContain('ToC label')
  })

  it('caps omnipresent bodies at maxOmnipresentTokens and falls back to descriptions', () => {
    // 10-token budget = 40 chars; first body fits, second (60 chars) doesn't
    const first = makeMemory({ key: '/a/one', content: 'x'.repeat(30), description: 'first desc' })
    const second = makeMemory({ key: '/a/two', content: 'y'.repeat(60), description: 'second desc' })

    const output = serializeTreeToC([first, second], { maxOmnipresentTokens: 10 })

    expect(output).toContain('x'.repeat(30))
    expect(output).not.toContain('y'.repeat(60))
    expect(output).toContain('second desc ...')
  })

  it('renders all omnipresent bodies when no cap is given', () => {
    const output = serializeTreeToC([
      makeMemory({ key: '/a/one', content: 'x'.repeat(5_000) }),
    ])
    expect(output).toContain('x'.repeat(5_000))
  })
})
