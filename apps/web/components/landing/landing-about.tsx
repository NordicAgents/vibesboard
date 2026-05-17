'use client'

import Image from 'next/image'

import { FadeIn } from './fade-in'
import {
  LANDING_ABOUT_HEADING,
  LANDING_ABOUT_PARAGRAPHS
} from '@/lib/landing-about-copy'

export function LandingAbout() {
  return (
    <section
      id="about"
      className="bg-beige-bg px-4 py-12 dark:bg-background sm:px-6 sm:py-16 lg:py-20"
    >
      <div className="container mx-auto">
        <div className="flex flex-col gap-8 sm:gap-12 md:flex-row lg:gap-16 xl:gap-24">
          <div className="w-full md:w-2/5 lg:w-1/3">
            <FadeIn delay={0.1}>
              <h2 className="mb-4 font-mono text-[11px] uppercase tracking-[0.14em] text-gray-secondary sm:mb-6 sm:text-sm lg:mb-8">
                [03] ABOUT VIBESBOARD
              </h2>
            </FadeIn>
            <FadeIn delay={0.2}>
              <div className="relative aspect-[4/3] overflow-hidden rounded-3xl border border-[#222f30]/10 bg-gray-200 shadow-soft dark:bg-muted sm:aspect-square">
                <Image
                  src="/images/landing/updated-landing/about.png"
                  alt="Vibesboard customer conversation automation workspace"
                  fill
                  className="object-cover"
                  sizes="(max-width: 768px) 100vw, 33vw"
                />
              </div>
            </FadeIn>
          </div>

          <div className="flex w-full flex-col justify-center md:w-3/5 lg:w-2/3">
            <FadeIn delay={0.3}>
              <h3 className="mb-4 font-switzer text-2xl font-medium leading-tight text-black-primary dark:text-foreground sm:mb-6 sm:text-3xl md:text-4xl lg:mb-8 lg:text-5xl">
                {LANDING_ABOUT_HEADING}
              </h3>
            </FadeIn>
            <FadeIn delay={0.4}>
              <div className="grid grid-cols-1 gap-4 text-base text-gray-secondary sm:gap-6 sm:text-lg lg:gap-8">
                {LANDING_ABOUT_PARAGRAPHS.map(paragraph => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </FadeIn>
          </div>
        </div>
      </div>
    </section>
  )
}
