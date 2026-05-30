import { describe, expect, it } from 'vitest'

import {
  appendSchedulingOAuthStatus,
  buildGoogleCalendarAuthPath,
  getSafeSchedulingReturnTo,
} from './oauth-return.ts'

describe('getSafeSchedulingReturnTo', () => {
  it('allows agent pages with query params', () => {
    expect(getSafeSchedulingReturnTo('/agents/SXlK9u9?tab=actions')).toBe(
      '/agents/SXlK9u9?tab=actions',
    )
  })

  it('allows the bare /agents path', () => {
    expect(getSafeSchedulingReturnTo('/agents')).toBe('/agents')
  })

  it('preserves hash fragments on agent paths', () => {
    expect(getSafeSchedulingReturnTo('/agents/x?tab=a#section')).toBe('/agents/x?tab=a#section')
  })

  it('rejects external and protocol-relative urls', () => {
    expect(getSafeSchedulingReturnTo('https://example.com')).toBe(null)
    expect(getSafeSchedulingReturnTo('//example.com/path')).toBe(null)
    expect(getSafeSchedulingReturnTo('/api/scheduling/auth/google')).toBe(null)
  })

  it('rejects non-agent absolute paths', () => {
    expect(getSafeSchedulingReturnTo('/dashboard')).toBe(null)
    // a path that merely starts with the substring "agents" but not the /agents segment
    expect(getSafeSchedulingReturnTo('/agentsmith')).toBe(null)
  })

  it('rejects relative paths that do not start with a single slash', () => {
    expect(getSafeSchedulingReturnTo('agents/x')).toBe(null)
  })

  it('returns null for empty / null / undefined input', () => {
    expect(getSafeSchedulingReturnTo('')).toBe(null)
    expect(getSafeSchedulingReturnTo(null)).toBe(null)
    expect(getSafeSchedulingReturnTo(undefined)).toBe(null)
  })

  it('rejects a path that escapes to another origin via backslashes/encoding', () => {
    // protocol-relative style is already covered; ensure a path that resolves
    // off-origin is rejected.
    expect(getSafeSchedulingReturnTo('/\\evil.com')).toBe(null)
  })
})

describe('buildGoogleCalendarAuthPath', () => {
  it('preserves a safe return target', () => {
    expect(buildGoogleCalendarAuthPath('/agents/SXlK9u9?tab=actions')).toBe(
      '/api/scheduling/auth/google?returnTo=%2Fagents%2FSXlK9u9%3Ftab%3Dactions',
    )
  })

  it('falls back to the bare auth path when returnTo is unsafe', () => {
    expect(buildGoogleCalendarAuthPath('https://evil.com')).toBe('/api/scheduling/auth/google')
  })

  it('falls back to the bare auth path when returnTo is omitted', () => {
    expect(buildGoogleCalendarAuthPath()).toBe('/api/scheduling/auth/google')
    expect(buildGoogleCalendarAuthPath(null)).toBe('/api/scheduling/auth/google')
  })
})

describe('appendSchedulingOAuthStatus', () => {
  it('adds a connected status to a safe return target', () => {
    expect(
      appendSchedulingOAuthStatus('/agents/SXlK9u9?tab=actions', 'scheduling_connected', 'true'),
    ).toBe('/agents/SXlK9u9?tab=actions&scheduling_connected=true')
  })

  it('adds an error status to a safe return target', () => {
    expect(appendSchedulingOAuthStatus('/agents/x', 'scheduling_error', 'denied')).toBe(
      '/agents/x?scheduling_error=denied',
    )
  })

  it('defaults to /agents when the return target is unsafe', () => {
    expect(appendSchedulingOAuthStatus('https://evil.com', 'scheduling_connected', 'true')).toBe(
      '/agents?scheduling_connected=true',
    )
  })

  it('defaults to /agents when the return target is missing', () => {
    expect(appendSchedulingOAuthStatus(null, 'scheduling_connected', 'true')).toBe(
      '/agents?scheduling_connected=true',
    )
    expect(appendSchedulingOAuthStatus(undefined, 'scheduling_error', 'x')).toBe(
      '/agents?scheduling_error=x',
    )
  })

  it('overwrites an existing value for the same status key', () => {
    expect(
      appendSchedulingOAuthStatus(
        '/agents/x?scheduling_connected=old',
        'scheduling_connected',
        'new',
      ),
    ).toBe('/agents/x?scheduling_connected=new')
  })
})
