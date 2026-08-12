import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, it, expect } from 'vitest'

import { LANDING_MEDIA, type LandingMediaAsset } from './landing-media.ts'

const PUBLIC_DIR = join(import.meta.dirname, '..', 'public')

const sources = (asset: LandingMediaAsset) => [asset.desktop, asset.mobile]

describe('landing media manifest', () => {
  it('ships every asset in both a desktop and a mobile art direction', () => {
    for (const asset of LANDING_MEDIA) {
      for (const source of sources(asset)) {
        expect(source.src, asset.id).toMatch(/^\/media\/landing\//)
        expect(source.width, asset.id).toBeGreaterThan(0)
        expect(source.height, asset.id).toBeGreaterThan(0)
      }
    }
  })

  it('gives every clip a poster frame so reduced-motion visitors see a still', () => {
    for (const asset of LANDING_MEDIA.filter(a => a.type === 'video')) {
      for (const source of sources(asset)) {
        expect(source.src, asset.id).toMatch(/\.mp4$/)
        expect(source.poster, asset.id).toMatch(/\.webp$/)
      }
    }
  })

  it('never ships a GIF — they cost megabytes where MP4 costs kilobytes', () => {
    for (const asset of LANDING_MEDIA) {
      for (const source of sources(asset)) {
        expect(source.src, asset.id).not.toMatch(/\.gif$/)
      }
    }
  })

  it('describes what happens in each frame, for screen readers', () => {
    for (const asset of LANDING_MEDIA) {
      expect(asset.alt.length, asset.id).toBeGreaterThan(40)
      expect(asset.alt, asset.id).not.toMatch(/^(image|video|screenshot)\b/i)
    }
  })

  it('has unique ids', () => {
    const ids = LANDING_MEDIA.map(asset => asset.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('points at files that actually exist in public/', () => {
    for (const asset of LANDING_MEDIA) {
      for (const source of sources(asset)) {
        expect(existsSync(join(PUBLIC_DIR, source.src)), source.src).toBe(true)
        if (source.poster) {
          expect(
            existsSync(join(PUBLIC_DIR, source.poster)),
            source.poster
          ).toBe(true)
        }
      }
    }
  })

  it('ships nothing the page does not reference', () => {
    const referenced = new Set(
      LANDING_MEDIA.flatMap(asset =>
        sources(asset).flatMap(source =>
          [source.src, source.poster].filter(Boolean)
        )
      ).map(path => path!.split('/').pop())
    )

    // Unreferenced media is dead weight in the deployed image and in every
    // clone of the repository.
    for (const file of readdirSync(join(PUBLIC_DIR, 'media', 'landing'))) {
      if (file.startsWith('.')) continue
      expect(referenced.has(file), `${file} is not in the manifest`).toBe(true)
    }
  })
})
