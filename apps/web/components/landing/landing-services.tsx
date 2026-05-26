'use client'

import Image from 'next/image'
import { ArrowUpRight } from 'lucide-react'
import { FadeIn } from './fade-in'
import {
  LANDING_SERVICES_HEADING,
  LANDING_SERVICES_ITEMS
} from '@/lib/landing-services-copy'

export function LandingServices() {
  return (
    <section
      id="services"
      className="border-t border-[#222f30]/5 bg-purewhite-bg px-4 py-12 dark:border-white/5 dark:bg-background sm:px-6 sm:py-16 lg:py-20"
    >
      <div className="container mx-auto">
        <div className="mb-8 flex flex-col items-start justify-between gap-4 sm:mb-12 md:flex-row md:gap-8 lg:mb-16">
          <FadeIn delay={0.1}>
            <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-gray-secondary sm:text-sm">
              [02] CAPABILITIES
            </h2>
          </FadeIn>
          <FadeIn delay={0.2} className="max-w-2xl">
            <p className="font-switzer text-xl leading-tight text-black-primary dark:text-foreground sm:text-2xl md:text-3xl lg:text-4xl">
              {LANDING_SERVICES_HEADING}
            </p>
          </FadeIn>
        </div>

        <div className="grid grid-cols-1 gap-0">
          {LANDING_SERVICES_ITEMS.map((service, index) => (
            <FadeIn key={service.id} delay={0.1 + index * 0.1} direction="left">
              <div className="group cursor-default border-t border-[#222f30]/10 py-6 transition-colors hover:bg-bg-hover dark:border-white/10 dark:hover:bg-white/5 sm:py-8 lg:py-12">
                <div className="grid gap-5 lg:grid-cols-[minmax(14rem,18rem)_1fr_auto] lg:items-center lg:gap-8 xl:grid-cols-[20rem_1fr_auto]">
                  <div className="relative aspect-[16/10] overflow-hidden rounded-2xl bg-[#111918]">
                    <Image
                      src={service.image}
                      alt={service.imageAlt}
                      fill
                      className="object-cover transition-transform duration-700 ease-custom group-hover:scale-105"
                      sizes="(max-width: 1024px) 100vw, 20rem"
                    />
                    <div className="absolute inset-0 bg-[#111918]/0 transition-colors duration-500 group-hover:bg-[#111918]/10" />
                  </div>

                  <div className="flex flex-col gap-3">
                    <div className="flex items-baseline gap-4 sm:gap-6">
                      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-gray-secondary sm:text-sm">
                        {service.id}
                      </span>
                      <h3 className="font-switzer text-xl font-medium text-black-primary dark:text-foreground sm:text-2xl md:text-3xl lg:text-4xl xl:text-5xl">
                        {service.title}
                      </h3>
                    </div>
                    <p className="max-w-xl text-sm leading-relaxed text-gray-secondary sm:text-base lg:max-w-md">
                      {service.description}
                    </p>
                  </div>

                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-[#222f30]/20 transition-all duration-300 group-hover:border-primary group-hover:bg-primary group-hover:text-primary-foreground sm:size-10">
                    <ArrowUpRight className="size-4 sm:size-5" />
                  </div>
                </div>
              </div>
            </FadeIn>
          ))}
          <div className="border-t border-[#222f30]/10 dark:border-white/10"></div>
        </div>
      </div>
    </section>
  )
}
