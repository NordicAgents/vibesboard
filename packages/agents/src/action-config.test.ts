import { describe, it, expect } from 'vitest'

import { getActionCapabilityStates } from './action-config.ts'

it('getActionCapabilityStates reports booking as ready once resources exist', () => {
  const states = getActionCapabilityStates({
    bookingConfig: {
      enabled: false,
      resources: [
        {
          id: 'r1',
          name: 'Glass Cabin',
          calendarConnectionId: 'conn-1',
          calendarId: 'cal-1',
          calendarName: 'Glass Cabin',
          timezone: 'UTC'
        }
      ],
      mode: 'direct',
      eventTitleTemplate: '{guest_name}',
      eventTimeMode: 'all-day',
      overlapProtection: true
    }
  })

  const booking = states.find(state => state.capability === 'booking')
  expect(booking).toBeTruthy()
  expect(booking!.status).toBe('ready')
  expect(booking!.summary).toMatch(/1 resource/)
  expect(booking!.summary).toMatch(/Mode: Direct/)
})

it('getActionCapabilityStates reports scheduling as needs setup without a calendar connection', () => {
  const states = getActionCapabilityStates({
    schedulingConfig: {
      enabled: false,
      calendarConnectionId: null,
      defaultDurationMinutes: 30,
      bufferMinutes: 0,
      timezone: 'UTC',
      availableHours: { start: '09:00', end: '17:00' },
      availableDays: [1, 2, 3, 4, 5],
      meetingTitleTemplate: 'Meeting with {{name}}',
      createMeetLink: true
    }
  })

  const scheduling = states.find(state => state.capability === 'scheduling')
  expect(scheduling).toBeTruthy()
  expect(scheduling!.status).toBe('needs_setup')
  expect(scheduling!.blocker).toBe(
    'Scheduling needs a calendar connection before it can be enabled.'
  )
})

it('getActionCapabilityStates reports data sync as enabled when connected', () => {
  const states = getActionCapabilityStates({
    dataConfig: {
      enabled: true,
      dataConnectionId: 'data-1',
      fieldMappings: [{ collectionFieldId: 'guest_name', targetColumn: 'Name' }],
      autoSubmitOnComplete: true,
      updateKeyField: null
    }
  })

  const data = states.find(state => state.capability === 'data')
  expect(data).toBeTruthy()
  expect(data!.status).toBe('enabled')
  expect(data!.summary).toMatch(/1 mapped field/)
})

describe('getActionCapabilityStates (expanded coverage)', () => {
  it('returns all four capabilities as not_configured when nothing is configured', () => {
    const states = getActionCapabilityStates({})
    expect(states.map(s => s.capability)).toEqual([
      'availability_only',
      'scheduling',
      'booking',
      'data'
    ])
    expect(states.every(s => s.status === 'not_configured')).toBe(true)
    expect(states.every(s => s.statusLabel === 'Not configured')).toBe(true)
  })

  it('booking needs_setup when an empty config has no resources', () => {
    const states = getActionCapabilityStates({
      bookingConfig: {
        enabled: false,
        resources: [],
        mode: 'direct',
        eventTitleTemplate: '{guest_name}',
        eventTimeMode: 'all-day',
        overlapProtection: true
      }
    })
    const booking = states.find(s => s.capability === 'booking')!
    expect(booking.status).toBe('needs_setup')
    expect(booking.blocker).toMatch(/bookable resource/)
  })

  it('booking enabled + enquiry mode pluralizes resources in the summary', () => {
    const states = getActionCapabilityStates({
      bookingConfig: {
        enabled: true,
        resources: [
          {
            id: 'r1',
            name: 'A',
            calendarConnectionId: 'c1',
            calendarId: 'cal1',
            calendarName: 'A',
            timezone: 'UTC'
          },
          {
            id: 'r2',
            name: 'B',
            calendarConnectionId: 'c2',
            calendarId: 'cal2',
            calendarName: 'B',
            timezone: 'UTC'
          }
        ],
        mode: 'enquiry',
        eventTitleTemplate: '{guest_name}',
        eventTimeMode: 'all-day',
        overlapProtection: true
      }
    })
    const booking = states.find(s => s.capability === 'booking')!
    expect(booking.status).toBe('enabled')
    expect(booking.summary).toMatch(/2 resources/)
    expect(booking.summary).toMatch(/Mode: Enquiry/)
  })

  it('scheduling: ready when connected but not enabled; enabled reports duration + timezone', () => {
    const base = {
      enabled: false,
      calendarConnectionId: 'conn-1',
      defaultDurationMinutes: 45,
      bufferMinutes: 0,
      timezone: 'Europe/Dublin',
      availableHours: { start: '09:00', end: '17:00' },
      availableDays: [1, 2, 3, 4, 5],
      meetingTitleTemplate: 'm',
      createMeetLink: true
    }
    const ready = getActionCapabilityStates({ schedulingConfig: base }).find(
      s => s.capability === 'scheduling'
    )!
    expect(ready.status).toBe('ready')
    expect(ready.ctaLabel).toBe('Enable')

    const enabled = getActionCapabilityStates({
      schedulingConfig: { ...base, enabled: true }
    }).find(s => s.capability === 'scheduling')!
    expect(enabled.status).toBe('enabled')
    expect(enabled.summary).toMatch(/45 min meetings/)
    expect(enabled.summary).toMatch(/Europe\/Dublin/)
  })

  it('availability_only transitions: needs_setup → ready → enabled', () => {
    const needsSetup = getActionCapabilityStates({
      calendarAvailabilityConfig: {
        enabled: false,
        calendarConnectionId: 'conn-1'
      } as never
    }).find(s => s.capability === 'availability_only')!
    expect(needsSetup.status).toBe('needs_setup')
    expect(needsSetup.blocker).toMatch(/connected calendar/)

    const ready = getActionCapabilityStates({
      calendarAvailabilityConfig: {
        enabled: false,
        calendarConnectionId: 'conn-1',
        calendarId: 'cal-1'
      } as never
    }).find(s => s.capability === 'availability_only')!
    expect(ready.status).toBe('ready')
    expect(ready.summary).toMatch(/1 calendar selected/)

    const enabled = getActionCapabilityStates({
      calendarAvailabilityConfig: {
        enabled: true,
        calendarConnectionId: 'conn-1',
        calendarId: 'cal-1'
      } as never
    }).find(s => s.capability === 'availability_only')!
    expect(enabled.status).toBe('enabled')
  })

  it('data: needs_setup with a config but no connection; ready when connected but disabled', () => {
    const needsSetup = getActionCapabilityStates({
      dataConfig: {
        enabled: false,
        dataConnectionId: null,
        fieldMappings: [],
        autoSubmitOnComplete: false,
        updateKeyField: null
      }
    }).find(s => s.capability === 'data')!
    expect(needsSetup.status).toBe('needs_setup')
    expect(needsSetup.summary).toMatch(/Choose a data connection/)

    const ready = getActionCapabilityStates({
      dataConfig: {
        enabled: false,
        dataConnectionId: 'data-1',
        fieldMappings: [],
        autoSubmitOnComplete: false,
        updateKeyField: null
      }
    }).find(s => s.capability === 'data')!
    expect(ready.status).toBe('ready')
    expect(ready.summary).toMatch(/0 mapped fields/)
  })
})
