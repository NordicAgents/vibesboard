import type {
  AgentBookingConfig,
  AgentCalendarAvailabilityConfig,
  AgentDataConfig,
  AgentSchedulingConfig
} from '@/lib/firestore-types'

export type ActionCapability =
  | 'availability_only'
  | 'scheduling'
  | 'booking'
  | 'data'

export type ActionCapabilityStatus =
  | 'not_configured'
  | 'needs_setup'
  | 'ready'
  | 'enabled'

interface ActionCapabilityInput {
  schedulingConfig?: AgentSchedulingConfig
  dataConfig?: AgentDataConfig
  calendarAvailabilityConfig?: AgentCalendarAvailabilityConfig
  bookingConfig?: AgentBookingConfig
}

export interface ActionCapabilityState {
  capability: ActionCapability
  title: string
  status: ActionCapabilityStatus
  statusLabel: string
  summary: string
  blocker?: string
  ctaLabel: string
  recommended?: boolean
}

function getStatusLabel(status: ActionCapabilityStatus): string {
  switch (status) {
    case 'enabled':
      return 'Enabled'
    case 'ready':
      return 'Ready'
    case 'needs_setup':
      return 'Needs setup'
    default:
      return 'Not configured'
  }
}

function getAvailabilityState(
  config: AgentCalendarAvailabilityConfig | undefined
): ActionCapabilityState {
  const hasConnection = !!config?.calendarConnectionId
  const hasCalendar = !!config?.calendarId
  const hasResourceName = !!config?.resourceName?.trim()
  const configured = hasConnection && hasCalendar

  const status: ActionCapabilityStatus = config?.enabled
    ? 'enabled'
    : configured
      ? 'ready'
      : hasConnection || hasResourceName
        ? 'needs_setup'
        : 'not_configured'

  const parts: string[] = [getStatusLabel(status)]
  if (hasResourceName) {
    parts.push(config!.resourceName!.trim())
  }
  if (configured) {
    parts.push('1 calendar selected')
  } else if (hasConnection) {
    parts.push('Choose which calendar to check')
  } else {
    parts.push('Single-resource legacy setup')
  }

  return {
    capability: 'availability_only',
    title: 'Availability Only',
    status,
    statusLabel: getStatusLabel(status),
    summary: parts.join(' · '),
    blocker:
      status === 'needs_setup'
        ? 'Availability Only needs a connected calendar and a selected calendar before it can be enabled.'
        : undefined,
    ctaLabel:
      status === 'not_configured'
        ? 'Set up'
        : status === 'needs_setup'
          ? 'Continue'
          : status === 'ready'
            ? 'Enable'
            : 'Edit'
  }
}

function getSchedulingState(
  config: AgentSchedulingConfig | undefined
): ActionCapabilityState {
  const hasConnection = !!config?.calendarConnectionId
  const configured = hasConnection
  const status: ActionCapabilityStatus = config?.enabled
    ? 'enabled'
    : configured
      ? 'ready'
      : config
        ? 'needs_setup'
        : 'not_configured'

  const summary =
    status === 'not_configured'
      ? 'Not configured · No calendar selected'
      : status === 'needs_setup'
        ? 'Needs setup · Choose a calendar connection'
        : `${getStatusLabel(status)} · ${config?.defaultDurationMinutes ?? 30} min meetings · ${config?.timezone ?? 'UTC'}`

  return {
    capability: 'scheduling',
    title: 'Scheduling',
    status,
    statusLabel: getStatusLabel(status),
    summary,
    blocker: !hasConnection
      ? 'Scheduling needs a calendar connection before it can be enabled.'
      : undefined,
    ctaLabel:
      status === 'not_configured'
        ? 'Set up'
        : status === 'needs_setup'
          ? 'Continue'
          : status === 'ready'
            ? 'Enable'
            : 'Edit'
  }
}

function getBookingState(
  config: AgentBookingConfig | undefined
): ActionCapabilityState {
  const resourceCount = config?.resources.length ?? 0
  const configured = resourceCount > 0
  const mode = config?.mode === 'direct' ? 'Direct' : 'Enquiry'
  const status: ActionCapabilityStatus = config?.enabled
    ? 'enabled'
    : configured
      ? 'ready'
      : config
        ? 'needs_setup'
        : 'not_configured'

  const summary =
    status === 'not_configured'
      ? 'Not configured · No bookable resources yet'
      : status === 'needs_setup'
        ? 'Needs setup · Add at least one bookable resource'
        : `${getStatusLabel(status)} · ${resourceCount} resource${resourceCount === 1 ? '' : 's'} · Mode: ${mode}`

  return {
    capability: 'booking',
    title: 'Simple Booking',
    status,
    statusLabel: getStatusLabel(status),
    summary,
    blocker:
      resourceCount === 0
        ? 'Simple booking needs at least one bookable resource before it can be enabled.'
        : undefined,
    ctaLabel:
      status === 'not_configured'
        ? 'Set up'
        : status === 'needs_setup'
          ? 'Continue'
          : status === 'ready'
            ? 'Enable'
            : 'Edit',
    recommended: true
  }
}

function getDataState(
  config: AgentDataConfig | undefined
): ActionCapabilityState {
  const hasConnection = !!config?.dataConnectionId
  const configured = hasConnection
  const status: ActionCapabilityStatus = config?.enabled
    ? 'enabled'
    : configured
      ? 'ready'
      : config
        ? 'needs_setup'
        : 'not_configured'

  const summary =
    status === 'not_configured'
      ? 'Not configured · Data sync can be used independently'
      : status === 'needs_setup'
        ? 'Needs setup · Choose a data connection'
        : `${getStatusLabel(status)} · ${config?.fieldMappings.length ?? 0} mapped field${config?.fieldMappings.length === 1 ? '' : 's'}`

  return {
    capability: 'data',
    title: 'Data Sync',
    status,
    statusLabel: getStatusLabel(status),
    summary,
    blocker: !hasConnection
      ? 'Data sync can be used independently.'
      : undefined,
    ctaLabel:
      status === 'not_configured'
        ? 'Set up'
        : status === 'needs_setup'
          ? 'Continue'
          : status === 'ready'
            ? 'Enable'
            : 'Edit'
  }
}

export function getActionCapabilityStates(
  input: ActionCapabilityInput
): ActionCapabilityState[] {
  return [
    getAvailabilityState(input.calendarAvailabilityConfig),
    getSchedulingState(input.schedulingConfig),
    getBookingState(input.bookingConfig),
    getDataState(input.dataConfig)
  ]
}
