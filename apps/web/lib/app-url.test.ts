import { describe, expect, it } from 'vitest'

import { resolveAppUrl } from './app-url'

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
