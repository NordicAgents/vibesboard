const AGENT_DASHBOARD_TABS = new Set([
  'setup',
  'knowledge',
  'notifications',
  'reviews',
  'actions',
  'integrations',
  'share',
  'history',
  'memory',
  'booking-enquiries'
])

export const isKnownAgentDashboardTab = (value: string): boolean =>
  AGENT_DASHBOARD_TABS.has(value)
