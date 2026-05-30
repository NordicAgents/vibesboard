import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  GoogleCalendarProvider,
  createCalendarEvent,
  createProvider,
  deleteCalendarEvent,
  getCalendarEvent,
  listCalendarEvents,
  updateCalendarEvent,
} from './index.ts'

const ORIGINAL_FETCH = globalThis.fetch

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  vi.restoreAllMocks()
})

describe('createProvider', () => {
  it('returns a GoogleCalendarProvider for the google_calendar provider', () => {
    const provider = createProvider(
      { provider: 'google_calendar', calendarId: 'primary' } as any,
      'access-token',
    )
    expect(provider).toBeInstanceOf(GoogleCalendarProvider)
  })

  it('throws for an unsupported provider', () => {
    expect(() =>
      createProvider({ provider: 'cal_com', calendarId: 'primary' } as any, 'tok'),
    ).toThrow(/Unsupported calendar provider: cal_com/)
  })
})

describe('GoogleCalendarProvider.checkAvailability', () => {
  let provider: GoogleCalendarProvider

  beforeEach(() => {
    provider = new GoogleCalendarProvider({ accessToken: 'tok', calendarId: 'primary' })
  })

  const availabilityParams = (over: Record<string, unknown> = {}) => ({
    date: '2030-01-02', // a Wednesday
    durationMinutes: 60,
    timezone: 'UTC',
    availableHours: { start: '09', end: '12' },
    availableDays: [0, 1, 2, 3, 4, 5, 6],
    bufferMinutes: 0,
    ...over,
  })

  it('returns [] without calling the API when the weekday is not available', async () => {
    const spy = vi.fn()
    globalThis.fetch = spy as unknown as typeof fetch
    // 2030-01-02 is a Wednesday (getDay() === 3); exclude it
    const slots = await provider.checkAvailability(availabilityParams({ availableDays: [0, 6] }))
    expect(slots).toEqual([])
    expect(spy).not.toHaveBeenCalled()
  })

  it('queries freeBusy with auth and returns the open slots', async () => {
    const spy = vi.fn(
      async () =>
        new Response(JSON.stringify({ calendars: { primary: { busy: [] } } }), { status: 200 }),
    )
    globalThis.fetch = spy as unknown as typeof fetch

    const slots = await provider.checkAvailability(availabilityParams())
    // 09:00-12:00 in 60-min slots with no busy and zero buffer -> 3 slots
    expect(slots.length).toBe(3)

    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://www.googleapis.com/calendar/v3/freeBusy')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
    const body = JSON.parse(init.body as string)
    expect(body.items).toEqual([{ id: 'primary' }])
  })

  it('excludes slots that overlap a busy interval', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            calendars: {
              primary: {
                busy: [{ start: '2030-01-02T10:00:00Z', end: '2030-01-02T11:00:00Z' }],
              },
            },
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch

    const slots = await provider.checkAvailability(availabilityParams())
    // 09:00 and 11:00 remain; 10:00 collides with busy
    expect(slots.length).toBe(2)
    expect(slots.some((s) => s.start === '2030-01-02T10:00:00.000Z')).toBe(false)
  })

  it('honours the buffer between slots', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ calendars: { primary: { busy: [] } } }), { status: 200 }),
    ) as unknown as typeof fetch

    // 09:00-12:00, 60-min slots + 60-min buffer -> starts at 09:00 and 11:00 only
    const slots = await provider.checkAvailability(
      availabilityParams({ bufferMinutes: 60 }),
    )
    expect(slots.length).toBe(2)
  })

  it('throws when the freeBusy request fails', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('denied', { status: 403 }),
    ) as unknown as typeof fetch
    await expect(provider.checkAvailability(availabilityParams())).rejects.toThrow(
      /Google Calendar API error \(403\): denied/,
    )
  })
})

describe('GoogleCalendarProvider.createEvent', () => {
  let provider: GoogleCalendarProvider

  beforeEach(() => {
    provider = new GoogleCalendarProvider({ accessToken: 'tok', calendarId: 'primary' })
  })

  const eventParams = (over: Record<string, unknown> = {}) => ({
    title: 'Sync',
    startTime: '2030-01-02T10:00:00.000Z',
    endTime: '2030-01-02T10:30:00.000Z',
    attendeeEmail: 'guest@example.com',
    attendeeName: 'Guest',
    timezone: 'UTC',
    ...over,
  })

  it('creates an event without a Meet link and returns the eventId + htmlLink', async () => {
    const spy = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: 'evt-1', htmlLink: 'https://cal/evt-1' }), {
          status: 200,
        }),
    )
    globalThis.fetch = spy as unknown as typeof fetch

    const result = await provider.createEvent(eventParams())
    expect(result.eventId).toBe('evt-1')
    expect(result.htmlLink).toBe('https://cal/evt-1')
    expect(result.meetLink).toBe(undefined)

    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/calendars/primary/events')
    expect(url).toContain('sendUpdates=all')
    expect(url).not.toContain('conferenceDataVersion')
    const body = JSON.parse(init.body as string)
    expect(body.summary).toBe('Sync')
    expect(body.attendees).toEqual([{ email: 'guest@example.com', displayName: 'Guest' }])
    expect(body.conferenceData).toBe(undefined)
  })

  it('requests a Meet link and extracts the video entry point', async () => {
    const spy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: 'evt-2',
            htmlLink: 'https://cal/evt-2',
            conferenceData: {
              entryPoints: [
                { entryPointType: 'phone', uri: 'tel:+123' },
                { entryPointType: 'video', uri: 'https://meet.google.com/abc' },
              ],
            },
          }),
          { status: 200 },
        ),
    )
    globalThis.fetch = spy as unknown as typeof fetch

    const result = await provider.createEvent(eventParams({ createMeetLink: true }))
    expect(result.meetLink).toBe('https://meet.google.com/abc')

    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('conferenceDataVersion=1')
    const body = JSON.parse(init.body as string)
    expect(body.conferenceData.createRequest.conferenceSolutionKey.type).toBe('hangoutsMeet')
  })

  it('throws when event creation fails', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('boom', { status: 500 }),
    ) as unknown as typeof fetch
    await expect(provider.createEvent(eventParams())).rejects.toThrow(
      /Google Calendar API error \(500\): boom/,
    )
  })
})

describe('GoogleCalendarProvider.updateEvent / deleteEvent', () => {
  let provider: GoogleCalendarProvider

  beforeEach(() => {
    provider = new GoogleCalendarProvider({ accessToken: 'tok', calendarId: 'primary' })
  })

  it('PATCHes only the provided fields', async () => {
    const spy = vi.fn(async () => new Response(null, { status: 204 }))
    globalThis.fetch = spy as unknown as typeof fetch

    await provider.updateEvent('evt-1', { title: 'New title', timezone: 'UTC' })
    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('PATCH')
    expect(url).toContain('/events/evt-1')
    const body = JSON.parse(init.body as string)
    expect(body.summary).toBe('New title')
    expect(body.start).toBe(undefined)
    expect(body.end).toBe(undefined)
  })

  it('DELETEs the event and tolerates a 204 No Content response', async () => {
    const spy = vi.fn(async () => new Response(null, { status: 204 }))
    globalThis.fetch = spy as unknown as typeof fetch
    await expect(provider.deleteEvent('evt-1')).resolves.toBeUndefined()
    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('DELETE')
    expect(url).toContain('/events/evt-1')
  })

  it('throws when delete fails', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('gone-wrong', { status: 500 }),
    ) as unknown as typeof fetch
    await expect(provider.deleteEvent('evt-1')).rejects.toThrow(
      /Google Calendar API error \(500\): gone-wrong/,
    )
  })
})

describe('standalone calendar event helpers', () => {
  it('listCalendarEvents maps items and requests singleEvents ordered by start', async () => {
    const spy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            items: [
              {
                id: 'e1',
                summary: 'Meeting',
                description: 'd',
                start: { dateTime: '2030-01-02T10:00:00Z' },
                end: { dateTime: '2030-01-02T11:00:00Z' },
                htmlLink: 'https://cal/e1',
              },
              {
                id: 'e2',
                // no summary -> '(no title)'
                start: { date: '2030-01-03' },
                end: { date: '2030-01-04' },
              },
            ],
          }),
          { status: 200 },
        ),
    )
    globalThis.fetch = spy as unknown as typeof fetch

    const events = await listCalendarEvents(
      'tok',
      'primary',
      '2030-01-01T00:00:00Z',
      '2030-01-31T00:00:00Z',
    )
    expect(events.length).toBe(2)
    expect(events[0]).toEqual({
      id: 'e1',
      summary: 'Meeting',
      description: 'd',
      start: '2030-01-02T10:00:00Z',
      end: '2030-01-02T11:00:00Z',
      htmlLink: 'https://cal/e1',
    })
    expect(events[1].summary).toBe('(no title)')
    expect(events[1].start).toBe('2030-01-03') // falls back to date

    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/calendars/primary/events')
    expect(url).toContain('singleEvents=true')
    expect(url).toContain('orderBy=startTime')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  })

  it('listCalendarEvents returns [] when there are no items', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({}), { status: 200 }),
    ) as unknown as typeof fetch
    expect(
      await listCalendarEvents('tok', 'primary', '2030-01-01T00:00:00Z', '2030-01-02T00:00:00Z'),
    ).toEqual([])
  })

  it('listCalendarEvents throws on a non-ok status', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('err', { status: 401 }),
    ) as unknown as typeof fetch
    await expect(
      listCalendarEvents('tok', 'primary', '2030-01-01T00:00:00Z', '2030-01-02T00:00:00Z'),
    ).rejects.toThrow(/Google Calendar API error \(401\): err/)
  })

  it('createCalendarEvent POSTs the payload to the encoded calendar id', async () => {
    const spy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ id: 'new', summary: 'X', start: { dateTime: 's' }, end: { dateTime: 'e' } }),
          { status: 200 },
        ),
    )
    globalThis.fetch = spy as unknown as typeof fetch

    const ev = await createCalendarEvent('tok', 'team@group.calendar.google.com', {
      summary: 'X',
      start: { dateTime: 's' },
      end: { dateTime: 'e' },
    })
    expect(ev.id).toBe('new')
    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/calendars/team%40group.calendar.google.com/events')
    expect(init.method).toBe('POST')
  })

  it('getCalendarEvent fetches a single event by id', async () => {
    const spy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ id: 'e1', summary: 'X', start: { dateTime: 's' }, end: { dateTime: 'e' } }),
          { status: 200 },
        ),
    )
    globalThis.fetch = spy as unknown as typeof fetch
    const ev = await getCalendarEvent('tok', 'primary', 'e1')
    expect(ev.id).toBe('e1')
    expect((spy.mock.calls[0][0] as string)).toContain('/events/e1')
  })

  it('updateCalendarEvent PATCHes the updates', async () => {
    const spy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ id: 'e1', summary: 'Y', start: { dateTime: 's' }, end: { dateTime: 'e' } }),
          { status: 200 },
        ),
    )
    globalThis.fetch = spy as unknown as typeof fetch
    const ev = await updateCalendarEvent('tok', 'primary', 'e1', { summary: 'Y' })
    expect(ev.summary).toBe('Y')
    expect((spy.mock.calls[0][1] as RequestInit).method).toBe('PATCH')
  })

  it('deleteCalendarEvent tolerates a 410 Gone response (already deleted)', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('Gone', { status: 410 }),
    ) as unknown as typeof fetch
    await expect(deleteCalendarEvent('tok', 'primary', 'e1')).resolves.toBeUndefined()
  })

  it('deleteCalendarEvent throws on other non-ok statuses', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('nope', { status: 500 }),
    ) as unknown as typeof fetch
    await expect(deleteCalendarEvent('tok', 'primary', 'e1')).rejects.toThrow(
      /Google Calendar API error \(500\): nope/,
    )
  })
})
