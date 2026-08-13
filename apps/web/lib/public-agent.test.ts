import { describe, expect, it } from 'vitest'

import { toPublicAgentResponse } from './public-agent.ts'

describe('toPublicAgentResponse', () => {
  it('removes both legacy and database access-password fields', () => {
    const response = toPublicAgentResponse({
      id: 'agent-1',
      name: 'Support',
      hasAccessPassword: true,
      accessPassword: 'legacy-secret',
      accessPasswordHash: 'database-secret'
    })

    expect(response).toEqual({
      id: 'agent-1',
      name: 'Support',
      hasAccessPassword: true
    })
    expect(response).not.toHaveProperty('accessPassword')
    expect(response).not.toHaveProperty('accessPasswordHash')
  })
})
