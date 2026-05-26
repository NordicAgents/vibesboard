'use client'

import Image from 'next/image'
import { FadeIn } from './fade-in'
import {
  LANDING_SHOWCASE_HEADING,
  LANDING_SHOWCASE_STEPS
} from '@/lib/landing-showcase-copy'

export function LandingShowcase() {
  return (
    <section
      id="works"
      className="bg-beige-bg px-4 py-12 sm:px-6 sm:py-16 lg:py-20"
    >
      <div className="container mx-auto">
        <div className="mb-8 flex flex-col items-start justify-between gap-4 sm:mb-12 md:flex-row md:gap-8 lg:mb-16">
          <FadeIn delay={0.1}>
            <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-gray-secondary sm:text-sm">
              [01] HOW IT WORKS
            </h2>
          </FadeIn>
          <FadeIn delay={0.2} className="max-w-2xl">
            <p className="font-switzer text-xl leading-tight text-black-primary dark:text-foreground sm:text-2xl md:text-3xl lg:text-4xl">
              {LANDING_SHOWCASE_HEADING}
            </p>
          </FadeIn>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-8 lg:gap-12">
          {LANDING_SHOWCASE_STEPS.map((step, index) => (
            <FadeIn key={step.id} delay={0.2 + index * 0.1}>
              <div className="group cursor-pointer rounded-3xl border border-[#222f30]/10 bg-purewhite-bg p-4 shadow-soft transition-transform duration-300 hover:-translate-y-1">
                <div className="relative mb-3 aspect-[4/3] overflow-hidden rounded-[1.25rem] bg-gray-100 dark:bg-muted sm:mb-4">
                  <Image
                    src={step.image}
                    alt={step.title}
                    fill
                    className="object-cover transition-transform duration-700 ease-custom group-hover:scale-105"
                    sizes="(max-width: 640px) 100vw, 50vw"
                  />
                  <div className="absolute inset-0 bg-[#222f30]/0 transition-colors duration-500 group-hover:bg-[#222f30]/10 dark:group-hover:bg-white/10"></div>
                </div>
                <div className="flex flex-col items-start justify-between gap-1 sm:flex-row sm:items-center sm:gap-0">
                  <h3 className="font-switzer text-lg font-medium text-black-primary dark:text-foreground sm:text-xl">
                    {step.title}
                  </h3>
                  <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-gray-secondary sm:text-sm">
                    {step.category}
                  </span>
                </div>
                <p className="mt-3 max-w-[38rem] font-switzer text-sm leading-relaxed text-gray-secondary dark:text-muted-foreground sm:text-base">
                  {step.description}
                </p>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  )
}
