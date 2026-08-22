import { describe, expect, it } from 'vitest'

import { isKnownAgentDashboardTab } from './agent-dashboard-tabs.ts'

describe('isKnownAgentDashboardTab', () => {
  it('accepts rendered dashboard tabs and rejects unknown query values', () => {
    expect(isKnownAgentDashboardTab('setup')).toBe(true)
    expect(isKnownAgentDashboardTab('booking-enquiries')).toBe(true)
    expect(isKnownAgentDashboardTab('zzz')).toBe(false)
    expect(isKnownAgentDashboardTab('')).toBe(false)
  })
})
