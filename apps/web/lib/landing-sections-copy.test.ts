import { describe, it, expect } from 'vitest'

import type { LandingOperator } from './landing-operator'
import {
  LANDING_CAPABILITIES,
  LANDING_CAPABILITIES_HEADING,
  LANDING_CHANNELS_POINTS,
  LANDING_COMMUNITY_ACTIONS,
  LANDING_DEPLOY_BODY,
  landingDeployOptions,
  LANDING_MODELS_BODY,
  LANDING_MODEL_PROVIDERS,
  LANDING_SECURITY_POINTS,
  LANDING_WHY_ITEMS
} from './landing-sections-copy.ts'

const OPERATOR_WITH_HOSTING: LandingOperator = {
  contactEmail: '',
  socials: [],
  siblingProducts: [],
  hostedName: 'example.com',
  hostedUrl: 'https://example.com/sign-in'
}

const UNCONFIGURED_OPERATOR: LandingOperator = {
  contactEmail: '',
  socials: [],
  siblingProducts: [],
  hostedName: '',
  hostedUrl: ''
}

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
      ...landingDeployOptions(OPERATOR_WITH_HOSTING).flatMap(option => [
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
  it('offers self-hosting first and hosted second when hosting is configured', () => {
    expect(
      landingDeployOptions(OPERATOR_WITH_HOSTING).map(option => option.id)
    ).toEqual(['self-hosted', 'hosted'])
  })

  it('omits the hosted card entirely on an unconfigured fork', () => {
    // Otherwise every fork of this public repository advertises, and links
    // visitors into, the upstream project's paid hosting.
    expect(
      landingDeployOptions(UNCONFIGURED_OPERATOR).map(option => option.id)
    ).toEqual(['self-hosted'])
  })

  it('names the configured operator rather than a hardcoded host', () => {
    const hosted = landingDeployOptions(OPERATOR_WITH_HOSTING)[1]
    expect(hosted.summary).toContain('example.com')
    expect(hosted.cta.href).toBe('https://example.com/sign-in')
  })

  it('discloses the open-core split instead of claiming nothing is held back', () => {
    // The repository ships an `ee/` directory under a separate licence. Copy
    // that says "no feature held back" would be untrue the moment Phase 2
    // lands, and a reader who opens ee/LICENSE would catch it.
    expect(LANDING_DEPLOY_BODY).toMatch(/MIT-licensed core/i)
    expect(LANDING_DEPLOY_BODY).toMatch(/ee\//)
    expect(LANDING_DEPLOY_BODY).not.toMatch(/no feature held back/i)
  })

  it('admits the cost of self-hosting instead of only selling it', () => {
    const selfHosted = landingDeployOptions(
      UNCONFIGURED_OPERATOR
    )[0].points.join(' ')
    expect(selfHosted).toMatch(/upgrades, backups and uptime/i)
  })

  it('does not claim features are withheld from the open-source build', () => {
    for (const option of landingDeployOptions(OPERATOR_WITH_HOSTING)) {
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

describe('landing copy carries no operator identity', () => {
  it('never names the upstream deployment when nothing is configured', () => {
    // Mirrors the legal-entity regression test: a fork must not inherit the
    // upstream project's host, contact address or social accounts.
    const copy = JSON.stringify([
      LANDING_DEPLOY_BODY,
      landingDeployOptions(UNCONFIGURED_OPERATOR),
      LANDING_WHY_ITEMS,
      LANDING_CAPABILITIES,
      LANDING_SECURITY_POINTS,
      LANDING_CHANNELS_POINTS
    ])
    expect(copy).not.toMatch(/vibesboard\.com/i)
    expect(copy).not.toMatch(/@vibesboard/i)
  })
})
