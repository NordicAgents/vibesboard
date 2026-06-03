import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

import {
  LANDING_SERVICES_HEADING,
  LANDING_SERVICES_ITEMS
} from './landing-services-copy.ts'

// Resolve the app's public/ relative to this test file (apps/web/lib/...), not
// process.cwd() — under the monorepo runner cwd is the repo root, not the app.
const appRoot = fileURLToPath(new URL('../', import.meta.url))

describe('landing services copy', () => {
  it('capabilities heading speaks to business outcomes', () => {
    expect(LANDING_SERVICES_HEADING).toBe(
      'Built for businesses that win by replying faster.'
    )
    expect(LANDING_SERVICES_HEADING).toMatch(/businesses|replying faster/i)
  })

  it('capabilities list matches the current customer-conversation business goal', () => {
    expect(LANDING_SERVICES_ITEMS.map(item => item.title)).toEqual([
      'Reply Before They Bounce',
      'Capture Every Lead',
      'Book More Appointments',
      'Know What Customers Want'
    ])

    const copy = LANDING_SERVICES_ITEMS.map(item => item.description).join(' ')

    expect(copy).toMatch(/WhatsApp|Instagram/i)
    expect(copy).toMatch(/qualify|names|needs/i)
    expect(copy).toMatch(/slots|reminders|quiet/i)
    expect(copy).toMatch(/people ask|deals stall|answers/i)
    expect(copy).not.toMatch(
      /unique personalities|all vibes|authentic reactions|community/i
    )
  })

  it('capabilities include relevant generated business visuals', () => {
    expect(LANDING_SERVICES_ITEMS.map(item => item.image)).toEqual([
      '/images/landing/capabilities/reply-before-they-bounce.png',
      '/images/landing/capabilities/capture-every-lead.png',
      '/images/landing/capabilities/book-more-appointments.png',
      '/images/landing/capabilities/know-what-customers-want.png'
    ])

    for (const item of LANDING_SERVICES_ITEMS) {
      expect(item.imageAlt).toMatch(/VibeAgent capability visual/i)
      expect(
        existsSync(join(appRoot, 'public', item.image.replace(/^\//, '')))
      ).toBe(true)
    }
  })
})
