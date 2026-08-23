import { describe, expect, it } from 'vitest'
import { isGoogleStorageImageUrl, safeImageUrl } from './safe-image-url.ts'

describe('safeImageUrl', () => {
  it('accepts HTTP and HTTPS image URLs', () => {
    expect(safeImageUrl('https://example.com/logo.svg')).toBe(
      'https://example.com/logo.svg'
    )
    expect(safeImageUrl('http://localhost:3000/logo.png')).toBe(
      'http://localhost:3000/logo.png'
    )
  })

  it('rejects executable, inline, and malformed URLs', () => {
    expect(safeImageUrl('javascript:alert(1)')).toBeNull()
    expect(safeImageUrl('data:image/svg+xml,<svg onload=alert(1)>')).toBeNull()
    expect(safeImageUrl('//example.com/logo.png')).toBeNull()
    expect(safeImageUrl('not-a-url')).toBeNull()
  })
})

describe('isGoogleStorageImageUrl', () => {
  it('accepts only the exact GCS host or a bucket subdomain', () => {
    expect(
      isGoogleStorageImageUrl(
        'https://storage.googleapis.com/bucket/tenant/logo.png'
      )
    ).toBe(true)
    expect(
      isGoogleStorageImageUrl(
        'https://bucket.storage.googleapis.com/tenant/logo.png'
      )
    ).toBe(true)
  })

  it('rejects lookalike and embedded hostnames', () => {
    expect(
      isGoogleStorageImageUrl(
        'https://storage.googleapis.com.attacker.example/logo.png'
      )
    ).toBe(false)
    expect(
      isGoogleStorageImageUrl(
        'https://attacker.example/storage.googleapis.com/logo.png'
      )
    ).toBe(false)
  })
})
