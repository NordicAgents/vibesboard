import { describe, expect, it } from 'vitest'
import { buildAgentSystemPrompt, COMPLETION_MARKERS } from './prompts.ts'

// Minimal VibeAgent-shaped fixture. buildAgentSystemPrompt only touches a
// handful of fields; we cast to any to avoid pulling the full contract type.
const agent = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'a1',
    name: 'Aria',
    instructions: 'Help the user.',
    tools: [],
    mode: 'provider',
    ...overrides,
  }) as any

describe('COMPLETION_MARKERS', () => {
  it('exposes the documented marker strings', () => {
    expect(COMPLETION_MARKERS.COLLECTION_COMPLETE).toBe('[COLLECTION_COMPLETE]')
    expect(COMPLETION_MARKERS.INFO_COMPLETE).toBe('[INFO_COMPLETE]')
  })
})

describe('buildAgentSystemPrompt', () => {
  it('grounds the prompt in the agent name and scope-enforcement preamble', () => {
    const p = buildAgentSystemPrompt(agent({ name: 'Aria' }))
    expect(p).toContain('You are "Aria", a focused AI assistant.')
    expect(p).toContain('## Scope Enforcement')
    expect(p).toContain('## Boundary Reminder')
  })

  it('embeds the agent instructions under the instructions heading', () => {
    const p = buildAgentSystemPrompt(agent({ instructions: 'be brief' }))
    expect(p).toContain('## Your Instructions')
    expect(p).toContain('be brief')
  })

  it('scopes to agent.domain when provided, else the agent name', () => {
    const withDomain = buildAgentSystemPrompt(
      agent({ name: 'Aria', domain: 'hotel bookings' }),
    )
    expect(withDomain).toContain('hotel bookings')
    const noDomain = buildAgentSystemPrompt(agent({ name: 'Aria', domain: undefined }))
    // Falls back to the name in the boundary reminder.
    expect(noDomain).toContain('**Aria**')
  })

  it('reports no external tools when the agent has none', () => {
    const p = buildAgentSystemPrompt(agent({ tools: [] }))
    expect(p).toContain('No external tools are enabled for this agent.')
  })

  it('lists configured tools by name and description', () => {
    const p = buildAgentSystemPrompt(
      agent({ tools: [{ type: 'builtin:web_fetch', name: 'web_fetch', description: 'Fetch a page' }] }),
    )
    expect(p).toContain('- web_fetch: Fetch a page')
  })

  it('includes the REFERENCE DOCUMENTS block when context is provided', () => {
    const p = buildAgentSystemPrompt(agent(), 'some loaded content')
    expect(p).toContain('REFERENCE DOCUMENTS')
    expect(p).toContain('some loaded content')
  })

  it('states no reference material when context is null/empty', () => {
    const p = buildAgentSystemPrompt(agent(), null)
    expect(p).toContain('No additional reference material is available')
    expect(p).not.toContain('REFERENCE DOCUMENTS')
  })

  it('adds a file-overflow note only when context exists and hasFileOverflow is set', () => {
    const withCtx = buildAgentSystemPrompt(agent(), 'ctx', { hasFileOverflow: true })
    expect(withCtx).toContain('Use the file_search tool to query their content')
    // No context -> no overflow note even if the flag is set.
    const noCtx = buildAgentSystemPrompt(agent(), null, { hasFileOverflow: true })
    expect(noCtx).not.toContain('too large to include in full')
  })

  it('emits provider-mode completion guidance by default', () => {
    const p = buildAgentSystemPrompt(agent({ mode: 'provider' }))
    expect(p).toContain('Information Providing Mode')
    expect(p).toContain(COMPLETION_MARKERS.INFO_COMPLETE)
  })

  it('emits collector-mode guidance and greeting for collector agents', () => {
    const p = buildAgentSystemPrompt(
      agent({ mode: 'collector', greetingText: 'Hi there!' }),
    )
    expect(p).toContain('Information Collection Mode')
    expect(p).toContain('Hi there!')
    expect(p).toContain(COMPLETION_MARKERS.COLLECTION_COMPLETE)
  })

  it('includes handoff instructions only when targets + names are present', () => {
    const withHandoff = buildAgentSystemPrompt(
      agent({ handoffTargets: ['id1'] }),
      null,
      { handoffTargetNames: { id1: 'Sales' } },
    )
    expect(withHandoff).toContain('## Agent Handoff')
    expect(withHandoff).toContain('"Sales" (ID: id1)')

    // Targets configured but no names map -> no handoff block.
    const noNames = buildAgentSystemPrompt(agent({ handoffTargets: ['id1'] }), null, {
      handoffTargetNames: {},
    })
    expect(noNames).not.toContain('## Agent Handoff')
  })

  it('injects a final-response wrap-up at the session limit (provider)', () => {
    const p = buildAgentSystemPrompt(agent({ mode: 'provider' }), null, {
      remainingResponses: 1,
    })
    expect(p).toContain('SESSION LIMIT')
    expect(p).toContain('FINAL response')
  })

  it('omits the wrap-up when there are plenty of responses left', () => {
    const p = buildAgentSystemPrompt(agent({ mode: 'provider' }), null, {
      remainingResponses: 10,
    })
    expect(p).not.toContain('SESSION LIMIT')
  })

  it('omits the wrap-up when remainingResponses is null', () => {
    const p = buildAgentSystemPrompt(agent({ mode: 'provider' }), null, {
      remainingResponses: null,
    })
    expect(p).not.toContain('SESSION LIMIT')
  })

  it('always reminds the model to mirror the user language', () => {
    const p = buildAgentSystemPrompt(agent())
    expect(p).toContain('Always respond in the same language as the user.')
  })
})
