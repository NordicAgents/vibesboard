import { describe, expect, it } from 'vitest'

import { filterHandoffAgents } from './agent-handoff-filter.ts'

const agents = [
  { id: '1', name: 'Billing Support', mode: 'provider' },
  { id: '2', name: 'Lead Intake', mode: 'collector' },
  { id: '3', name: 'Technical Support', mode: 'provider' }
]

describe('filterHandoffAgents', () => {
  it('matches agent names case-insensitively', () => {
    expect(filterHandoffAgents(agents, 'SUPPORT', 'all')).toEqual([
      agents[0],
      agents[2]
    ])
  })

  it('combines search and mode filters', () => {
    expect(filterHandoffAgents(agents, 'lead', 'collector')).toEqual([
      agents[1]
    ])
    expect(filterHandoffAgents(agents, '', 'provider')).toEqual([
      agents[0],
      agents[2]
    ])
  })
})
