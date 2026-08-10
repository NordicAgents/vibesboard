import { describe, expect, it } from 'vitest'
import { getApiErrorMessage } from './api-error.ts'

describe('getApiErrorMessage', () => {
  it('includes field paths from validation issues', () => {
    expect(
      getApiErrorMessage(
        {
          error: 'Invalid input',
          issues: [
            { path: ['name'], message: 'Must contain at least 2 characters' },
            {
              path: ['bookingConfig', 'resources', 0, 'calendarId'],
              message: 'Required'
            }
          ]
        },
        'Failed to save'
      )
    ).toBe(
      'Invalid input — name: Must contain at least 2 characters; bookingConfig.resources.0.calendarId: Required'
    )
  })

  it('falls back safely for unknown response bodies', () => {
    expect(getApiErrorMessage({}, 'Failed to save')).toBe('Failed to save')
  })
})
