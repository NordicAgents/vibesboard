import type { AgentBookingConfig } from '@vibesboard/contracts'

export interface DirectBookingAccessWarning {
  title: string
  message: string
  actionLabel: string
}

export const DIRECT_BOOKING_ANONYMOUS_WARNING: DirectBookingAccessWarning = {
  title: 'Protect direct booking access',
  message:
    'Direct booking can create, edit, list, and cancel calendar events. Anonymous chat is currently enabled, so anyone with the agent link may be able to manage bookings. Turn off anonymous chat in Setup and set an access password before using Direct mode.',
  actionLabel: 'Go to Setup'
}

export function getDirectBookingAccessWarning(
  config: AgentBookingConfig | undefined,
  allowAnonymous: boolean
): DirectBookingAccessWarning | null {
  if (!config?.enabled) return null
  if (config.mode !== 'direct') return null
  if (!allowAnonymous) return null
  return DIRECT_BOOKING_ANONYMOUS_WARNING
}
