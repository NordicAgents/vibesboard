'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'

import { Button } from '@/components/ui/button'
import { FadeIn } from './fade-in'
import { LandingHeroBackground } from './landing-hero-background'

export function LandingHero() {
  return (
    <section className="relative flex min-h-dvh items-center justify-center overflow-hidden pt-16 sm:pt-20">
      <LandingHeroBackground />

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

          <div className="mx-auto max-w-md text-center lg:mx-0 lg:ml-auto lg:text-left">
            <FadeIn delay={0.5}>
              <p className="text-white/88 rounded-3xl border border-white/15 bg-[#111918]/30 p-6 text-base leading-relaxed backdrop-blur-sm sm:text-lg">
                Build custom agents and share them to vibe with people. All
                interactions are recorded, and you can discover the real vibe
                from people using AI-powered insights.
              </p>
            </FadeIn>
          </div>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.5, duration: 1 }}
        className="absolute bottom-6 left-1/2 z-10 hidden -translate-x-1/2 sm:bottom-10 sm:block"
      >
        <div className="h-12 w-px overflow-hidden bg-white/20 sm:h-16">
          <motion.div
            animate={{ y: ['-100%', '100%'] }}
            transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
            className="h-1/2 w-full bg-[#cef79e]"
          />
        </div>
      </motion.div>
    </section>
  )
}
