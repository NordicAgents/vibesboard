import type { AgentBookingConfig } from '@vibesboard/contracts'

const DIRECT_BOOKING_TERMS = [
  'book',
  'booking',
  'bookings',
  'reservation',
  'reservations',
  'availability',
  'calendar',
  'cancel',
  'reschedule'
]

const RESOURCE_TERMS = [
  'resort',
  'room',
  'rooms',
  'cabin',
  'cabins',
  'property',
  'properties',
  'villa',
  'villas',
  'rental',
  'rentals'
]

export function createDirectBookingDraftConfig(): AgentBookingConfig {
  return {
    enabled: false,
    resources: [],
    mode: 'direct',
    eventTitleTemplate: '{guest_name} ({guest_count} guests)',
    eventTimeMode: 'all-day',
    overlapProtection: true
  }
}

export function detectDirectBookingIntent(text: string): boolean {
  const normalized = text.toLowerCase()
  const hasBookingTerm = DIRECT_BOOKING_TERMS.some(term =>
    normalized.includes(term)
  )
  const hasResourceTerm = RESOURCE_TERMS.some(term => normalized.includes(term))

  return hasBookingTerm && hasResourceTerm
}

export function getBookingConfigSummary(
  config: AgentBookingConfig | undefined
): string | null {
  if (!config) return null

  const resourceCount = config.resources.length
  const mode = config.mode === 'direct' ? 'Direct booking' : 'Enquiry booking'

  if (resourceCount === 0) {
    return `${mode} setup needed: add room calendars`
  }

  return `${mode}: ${resourceCount} room calendar${resourceCount === 1 ? '' : 's'}`
}

export function resolveAgentCreatorBookingConfig(input: {
  name?: string | null
  instructions?: string | null
  greetingText?: string | null
  bookingConfig?: AgentBookingConfig | null
}): AgentBookingConfig | undefined {
  if (input.bookingConfig) return input.bookingConfig

  const text = [input.name, input.instructions, input.greetingText]
    .filter((value): value is string => typeof value === 'string')
    .join('\n')

  return detectDirectBookingIntent(text)
    ? createDirectBookingDraftConfig()
    : undefined
}
