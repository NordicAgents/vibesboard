import { describe, expect, it } from 'vitest'

import { buildShareUrl } from './share-url.ts'

describe('buildShareUrl', () => {
  it('uses the first forwarded host and protocol values', () => {
    const headers = new Headers({
      'x-forwarded-host': 'agents.example.com, proxy.internal',
      'x-forwarded-proto': 'https, http'
    })

    expect(buildShareUrl(headers, 'acme', 'support')).toBe(
      'https://agents.example.com/acme/support'
    )
  })

  it('uses http for a direct localhost request', () => {
    const headers = new Headers({ host: 'localhost:3000' })

    expect(buildShareUrl(headers, 'personal', 'helper')).toBe(
      'http://localhost:3000/personal/helper'
    )
  })

  it('falls back to the configured application URL when request headers are absent', () => {
    expect(
      buildShareUrl(new Headers(), 'acme', 'sales', 'https://app.example.com/')
    ).toBe('https://app.example.com/acme/sales')
  })
})
