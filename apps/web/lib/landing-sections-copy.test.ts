import { describe, it, expect } from 'vitest'

import {
  LANDING_CAPABILITIES,
  LANDING_CAPABILITIES_HEADING,
  LANDING_CHANNELS_POINTS,
  LANDING_COMMUNITY_ACTIONS,
  LANDING_DEPLOY_OPTIONS,
  LANDING_MODELS_BODY,
  LANDING_MODEL_PROVIDERS,
  LANDING_SECURITY_POINTS,
  LANDING_WHY_ITEMS
} from './landing-sections-copy.ts'

describe('landing why copy', () => {
  it('answers the six needs from the README comparison', () => {
    expect(LANDING_WHY_ITEMS).toHaveLength(6)

    const answers = LANDING_WHY_ITEMS.map(item => item.answer).join(' ')
    expect(answers).toMatch(/rollback/i)
    expect(answers).toMatch(/WhatsApp and Instagram/)
    expect(answers).toMatch(/webhooks/i)
    expect(answers).toMatch(/row-level security/i)
    expect(answers).toMatch(/per agent or per task/)
  })
})

describe('landing capabilities copy', () => {
  it('covers the eight platform capabilities with unique icons', () => {
    expect(LANDING_CAPABILITIES).toHaveLength(8)

    const icons = LANDING_CAPABILITIES.map(capability => capability.icon)
    expect(new Set(icons).size).toBe(icons.length)
  })

  it('describes mechanisms, not adjectives', () => {
    const body = LANDING_CAPABILITIES.map(c => c.body).join(' ')
    expect(body).toMatch(/pgvector/)
    expect(body).toMatch(/Webhooks/)
    expect(body).toMatch(/Google Calendar/)
    expect(body).toMatch(/row-level security/i)
    expect(body).not.toMatch(/seamless|cutting-edge|revolutionary/i)
  })

  it('keeps the heading about consolidation', () => {
    expect(LANDING_CAPABILITIES_HEADING).toMatch(/one control plane/i)
  })
})

describe('landing copy against what the build actually ships', () => {
  // Postgres records monthly usage and an operator can set a soft workspace
  // cap, but the self-hosted build intentionally has no paid plan ceiling.
  it('does not imply that self-hosting has a paid plan ceiling', () => {
    const copy = [
      ...LANDING_WHY_ITEMS.map(item => `${item.need} ${item.answer}`),
      ...LANDING_CAPABILITIES.map(c => `${c.title} ${c.body}`),
      ...LANDING_DEPLOY_OPTIONS.flatMap(option => [
        option.summary,
        ...option.points
      ])
    ].join(' ')

    expect(copy).not.toMatch(/usage (and )?limits/i)
    expect(copy).toMatch(/no usage ceiling/i)
  })
})

describe('landing channels copy', () => {
  it('leads with the human handoff, which is the hard part', () => {
    const points = LANDING_CHANNELS_POINTS.map(
      point => `${point.title} ${point.body}`
    ).join(' ')
    expect(points).toMatch(/pause the agent/i)
    expect(points).toMatch(/24-hour messaging window/i)
    expect(points).toMatch(/Chatwoot/)
  })
})

describe('landing models copy', () => {
  it('lists every supported provider family', () => {
    expect(LANDING_MODEL_PROVIDERS).toEqual([
      'OpenAI',
      'Anthropic',
      'Google Gemini',
      'NVIDIA',
      'OpenAI-compatible'
    ])
  })

  it('is honest that the platform key is only a fallback', () => {
    expect(LANDING_MODELS_BODY).toMatch(/fallback/i)
  })
})

describe('landing deploy copy', () => {
  it('offers self-hosting first and hosted second', () => {
    expect(LANDING_DEPLOY_OPTIONS.map(option => option.id)).toEqual([
      'self-hosted',
      'hosted'
    ])
  })

  it('admits the cost of self-hosting instead of only selling it', () => {
    const selfHosted = LANDING_DEPLOY_OPTIONS[0].points.join(' ')
    expect(selfHosted).toMatch(/upgrades, backups and uptime/i)
  })

  it('does not claim features are withheld from the open-source build', () => {
    for (const option of LANDING_DEPLOY_OPTIONS) {
      expect(option.points.join(' '), option.id).not.toMatch(
        /enterprise only|premium only|paid tier only/i
      )
    }
  })
})

describe('landing security copy', () => {
  it('explains isolation, secrets, storage and CI scanning', () => {
    expect(LANDING_SECURITY_POINTS).toHaveLength(4)
    const body = LANDING_SECURITY_POINTS.map(p => p.body).join(' ')
    expect(body).toMatch(/returns nothing/i)
    expect(body).toMatch(/encrypted per workspace/i)
    expect(body).toMatch(/Semgrep|Trivy/)
  })
})

describe('landing community copy', () => {
  it('points every action at the repository', () => {
    expect(LANDING_COMMUNITY_ACTIONS.length).toBeGreaterThan(2)
    for (const action of LANDING_COMMUNITY_ACTIONS) {
      expect(action.href, action.label).toMatch(
        /^https:\/\/github\.com\/NordicAgents\/vibesboard/
      )
    }
  })
})
