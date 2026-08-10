'use client'

import { useEffect, useRef, useState } from 'react'

import { cn } from '@vibesboard/utils'

import type { LandingMediaAsset } from '@/lib/landing-media'

/**
 * Renders a manifest asset with the right art direction for the viewport.
 *
 * The poster always renders as a plain `<picture>` — CSS picks the desktop or
 * mobile still with no JavaScript and no hydration mismatch, which keeps it
 * usable as the LCP element. Video is a progressive enhancement layered on top:
 * it only mounts once the block scrolls into view, and never when the visitor
 * has asked for reduced motion.
 */
export function LandingMedia({
  asset,
  className,
  priority = false,
  sizes
}: {
  asset: LandingMediaAsset
  className?: string
  /** Set on the single above-the-fold asset so its poster is fetched eagerly. */
  priority?: boolean
  sizes?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [source, setSource] = useState<'desktop' | 'mobile' | null>(null)

  useEffect(() => {
    if (asset.type !== 'video') return

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (motionQuery.matches) return

    const widthQuery = window.matchMedia('(min-width: 768px)')
    const pick = () => (widthQuery.matches ? 'desktop' : 'mobile')

    const node = containerRef.current
    if (!node) return

    // Mounting the <video> is what triggers the network fetch, so gate it on
    // visibility rather than paying for every clip on first paint.
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setSource(pick())
          observer.disconnect()
        }
      },
      { rootMargin: '200px' }
    )
    observer.observe(node)

    const onResize = () => setSource(current => (current ? pick() : current))
    widthQuery.addEventListener('change', onResize)

    return () => {
      observer.disconnect()
      widthQuery.removeEventListener('change', onResize)
    }
  }, [asset.type])

  const active = source === 'mobile' ? asset.mobile : asset.desktop
  const desktopStill = asset.desktop.poster ?? asset.desktop.src
  const mobileStill = asset.mobile.poster ?? asset.mobile.src

  return (
    <div
      ref={containerRef}
      className={cn('landing-media relative overflow-hidden', className)}
      style={
        {
          '--landing-media-ratio-desktop': `${asset.desktop.width} / ${asset.desktop.height}`,
          '--landing-media-ratio-mobile': `${asset.mobile.width} / ${asset.mobile.height}`
        } as React.CSSProperties
      }
    >
      {/* A plain <img> inside <picture>: next/image cannot swap to a different
          crop per breakpoint, and these assets are art-directed, not resized. */}
      <picture>
        <source media="(max-width: 767px)" srcSet={mobileStill} />
        <img
          src={desktopStill}
          alt={asset.alt}
          width={asset.desktop.width}
          height={asset.desktop.height}
          sizes={sizes}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          decoding={priority ? 'sync' : 'async'}
          className="size-full object-cover"
        />
      </picture>

      {source !== null && (
        <video
          key={active.src}
          className="absolute inset-0 size-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          preload="none"
          poster={active.poster}
          aria-label={asset.alt}
        >
          <source src={active.src} type="video/mp4" />
        </video>
      )}
    </div>
  )
}
