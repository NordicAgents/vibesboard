import { afterEach, describe, expect, it } from 'vitest'

import { getCanonicalOrigin, resolveAppUrl } from './app-url'

describe('resolveAppUrl', () => {
  it('uses localhost when the build-time value is missing or blank', () => {
    expect(resolveAppUrl(undefined).href).toBe('http://localhost:3000/')
    expect(resolveAppUrl('').href).toBe('http://localhost:3000/')
    expect(resolveAppUrl('   ').href).toBe('http://localhost:3000/')
  })

  it('uses a configured absolute URL', () => {
    expect(resolveAppUrl('https://agents.example.com').href).toBe(
      'https://agents.example.com/'
    )
  })
})

describe('getCanonicalOrigin', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_APP_URL
  })

  it('does not let a request-derived host override the configured app origin', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com/some/path'
    expect(getCanonicalOrigin('https://attacker.invalid')).toBe(
      'https://app.example.com'
    )
  })
})
