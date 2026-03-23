'use client'

import Image from 'next/image'
import Link from 'next/link'
import { motion } from 'framer-motion'

import { Button } from '@/components/ui/button'
import { FadeIn } from './fade-in'

export function LandingHero() {
  return (
    <section className="relative flex min-h-dvh items-center justify-center overflow-hidden pt-16 sm:pt-20">
      <div className="absolute inset-0 z-0">
        <Image
          src="/images/landing/hero-bg.png"
          alt="Hero background"
          fill
          className="object-cover"
          priority
        />
        <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(17,25,24,0.78),rgba(17,25,24,0.58),rgba(167,226,110,0.18))]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(206,247,158,0.22),transparent_42%)]" />
      </div>

      <div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-2 lg:gap-12">
          <div className="text-center lg:text-left">
            <FadeIn delay={0.2}>
              <p className="mb-5 font-mono text-[11px] uppercase tracking-[0.18em] text-[#cef79e]">
                Engineering Better Conversations
              </p>
              <h1 className="mb-6 font-switzer text-[clamp(2rem,8vw,5rem)] font-bold leading-[1.02] tracking-[-0.06em] text-white sm:mb-8 lg:text-[clamp(3rem,6vw,5.5rem)]">
                Build Agents for Vibing with People
              </h1>
            </FadeIn>
            <FadeIn delay={0.4}>
              <Button
                asChild
                className="px-6 py-5 text-base sm:px-8 sm:py-6 sm:text-lg"
              >
                <Link href="/sign-in">Get Started</Link>
              </Button>
            </FadeIn>
          </div>

        </div>
      </div>

    </section>
  )
}
