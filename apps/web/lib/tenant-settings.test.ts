import { describe, expect, it } from 'vitest'
import { canShowGoogleReview } from './tenant-settings.ts'

describe('canShowGoogleReview', () => {
  it('hides Google Review from personal workspaces', () => {
    expect(canShowGoogleReview(true, true)).toBe(false)
  })

  it('shows Google Review only for enabled team workspaces', () => {
    expect(canShowGoogleReview(false, true)).toBe(true)
    expect(canShowGoogleReview(false, false)).toBe(false)
  })
})
