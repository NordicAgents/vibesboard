export interface BookingCalendarEvent {
  id: string
  summary: string
  start: string
  end: string
}

export interface ResourceAvailabilityResult {
  resourceName: string
  available: boolean
}

function parseDateBoundary(value: string): number {
  const iso = value.includes('T') ? value : `${value}T00:00:00`
  return new Date(
    iso.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(iso) ? iso : `${iso}Z`
  ).getTime()
}

export function findOverlappingCalendarEvents<T extends BookingCalendarEvent>(
  events: T[],
  start: string,
  end: string
): T[] {
  const startMs = parseDateBoundary(start)
  const endMs = parseDateBoundary(end)

  return events.filter(event => {
    const eventStart = parseDateBoundary(event.start)
    const eventEnd = parseDateBoundary(event.end)
    return startMs < eventEnd && endMs > eventStart
  })
}

export function formatMultiResourceAvailability({
  startDatetime,
  endDatetime,
  timezone,
  results
}: {
  startDatetime: string
  endDatetime: string
  timezone: string
  results: ResourceAvailabilityResult[]
}): string {
  const lines = results
    .map(
      result =>
        `- ${result.resourceName}: ${result.available ? 'available' : 'unavailable'}`
    )
    .join('\n')

  return `Availability from ${startDatetime} to ${endDatetime} (${timezone}):\n${lines}`
}
