import { describe, it, expect } from 'vitest'
// Warm up Vite's SSR module pipeline with a non-`server-only` sibling first so
// the `server-only` → no-op stub alias is applied before notifications.ts (which
// leads with `import 'server-only'`) is resolved. Mirrors how policy/usage.test
// imports a plain module ahead of its `server-only`-leading unit under test.
import '../db.ts'
import { mapCompletionToEvent } from '../notifications.ts'

describe('mapCompletionToEvent', () => {
  it('maps all completion-style reasons to the "completed" event', () => {
    for (const reason of [
      'collection_complete',
      'info_complete',
      'max_responses',
      'max_messages'
    ] as const) {
      expect(mapCompletionToEvent(reason)).toBe('completed')
    }
  })

  it('maps human handoff to "handoff"', () => {
    expect(mapCompletionToEvent('handoff_to_human')).toBe('handoff')
  })

  it('maps agent handoff to "agent_handoff"', () => {
    expect(mapCompletionToEvent('handoff_to_agent')).toBe('agent_handoff')
  })

  it('returns null for an unknown / unhandled reason', () => {
    expect(mapCompletionToEvent('none' as never)).toBe(null)
    expect(mapCompletionToEvent('something_else' as never)).toBe(null)
  })
})
