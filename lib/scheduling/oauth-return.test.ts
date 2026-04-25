import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appendSchedulingOAuthStatus,
  buildGoogleCalendarAuthPath,
  getSafeSchedulingReturnTo
} from './oauth-return.ts'

test('getSafeSchedulingReturnTo allows agent pages with query params', () => {
  assert.equal(
    getSafeSchedulingReturnTo('/agents/SXlK9u9?tab=actions'),
    '/agents/SXlK9u9?tab=actions'
  )
})

test('getSafeSchedulingReturnTo rejects external and protocol-relative urls', () => {
  assert.equal(getSafeSchedulingReturnTo('https://example.com'), null)
  assert.equal(getSafeSchedulingReturnTo('//example.com/path'), null)
  assert.equal(getSafeSchedulingReturnTo('/api/scheduling/auth/google'), null)
})

test('buildGoogleCalendarAuthPath preserves a safe return target', () => {
  assert.equal(
    buildGoogleCalendarAuthPath('/agents/SXlK9u9?tab=actions'),
    '/api/scheduling/auth/google?returnTo=%2Fagents%2FSXlK9u9%3Ftab%3Dactions'
  )
})

test('appendSchedulingOAuthStatus adds status to return target', () => {
  assert.equal(
    appendSchedulingOAuthStatus(
      '/agents/SXlK9u9?tab=actions',
      'scheduling_connected',
      'true'
    ),
    '/agents/SXlK9u9?tab=actions&scheduling_connected=true'
  )
})
