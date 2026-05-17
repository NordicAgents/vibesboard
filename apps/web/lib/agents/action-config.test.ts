import test from 'node:test'
import assert from 'node:assert/strict'

import { getActionCapabilityStates } from './action-config.ts'

test('getActionCapabilityStates reports booking as ready once resources exist', () => {
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
  assert.ok(booking)
  assert.equal(booking.status, 'ready')
  assert.match(booking.summary, /1 resource/)
  assert.match(booking.summary, /Mode: Direct/)
})

test('getActionCapabilityStates reports scheduling as needs setup without a calendar connection', () => {
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
  assert.ok(scheduling)
  assert.equal(scheduling.status, 'needs_setup')
  assert.equal(
    scheduling.blocker,
    'Scheduling needs a calendar connection before it can be enabled.'
  )
})

test('getActionCapabilityStates reports data sync as enabled when connected', () => {
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
  assert.ok(data)
  assert.equal(data.status, 'enabled')
  assert.match(data.summary, /1 mapped field/)
})
