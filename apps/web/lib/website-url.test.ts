import { describe, expect, it } from 'vitest'

import { extractWebsiteUrls } from './website-url.ts'

describe('extractWebsiteUrls', () => {
  it('normalizes a bare domain into an HTTPS URL', () => {
    expect(extractWebsiteUrls('Build an agent for justprint.io')).toEqual([
      'https://justprint.io'
    ])
  })

  it('preserves explicitly supplied HTTP(S) URLs and removes duplicates', () => {
    expect(
      extractWebsiteUrls(
        'https://example.com/path?x=1 and http://example.org — https://example.com/path?x=1'
      )
    ).toEqual(['https://example.com/path?x=1', 'http://example.org'])
  })
})
