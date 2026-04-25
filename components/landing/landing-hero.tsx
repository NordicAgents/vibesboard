'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'

import { Button } from '@/components/ui/button'
import {
  LANDING_HERO_CONVERSATION,
  LANDING_HERO_TAGLINE,
  type LandingHeroConversationMessage
} from '@/lib/landing-hero-copy'

/* ── animation config ─────────────────────────────────── */
const ease = [0.21, 0.47, 0.32, 0.98] as const
const springEase = [0.16, 1, 0.3, 1] as const

const wordReveal = {
  hidden: { opacity: 0, y: 40, filter: 'blur(12px)' },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.8, delay: 0.15 + i * 0.08, ease }
  })
}

const fadeUp = (delay: number) => ({
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, delay, ease }
  }
})

const streakReveal = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 2, ease: springEase }
  }
}

const phoneEntry = {
  hidden: { y: 160, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: { duration: 1.2, delay: 0.3, ease: springEase }
  }
}

const ringPop = (delay: number) => ({
  hidden: { scale: 0.5, opacity: 0 },
  visible: {
    scale: 1,
    opacity: 1,
    transition: { duration: 1.4, delay, ease: springEase }
  }
})

const msgReveal = (delay: number) => ({
  hidden: { opacity: 0, y: 14, scale: 0.96 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.45, delay, ease }
  }
})

/* Aurora blob float animations */
const auroraFloat1 = {
  x: [0, 30, -20, 0] as number[],
  y: [0, -25, 15, 0] as number[],
  scale: [1, 1.08, 0.95, 1] as number[],
  transition: { duration: 14, repeat: Infinity, ease: 'easeInOut' as const }
}

const auroraFloat2 = {
  x: [0, -40, 25, 0] as number[],
  y: [0, 20, -30, 0] as number[],
  scale: [1, 0.92, 1.06, 1] as number[],
  transition: {
    duration: 18,
    repeat: Infinity,
    ease: 'easeInOut' as const,
    delay: 2
  }
}

const auroraFloat3 = {
  x: [0, 50, -30, 0] as number[],
  y: [0, -15, 25, 0] as number[],
  scale: [1, 1.1, 0.93, 1] as number[],
  transition: {
    duration: 16,
    repeat: Infinity,
    ease: 'easeInOut' as const,
    delay: 4
  }
}

const phoneFloat = {
  y: [0, -12, 0] as number[],
  transition: { duration: 7, repeat: Infinity, ease: 'easeInOut' as const }
}

function AgentConversationMessage({
  message,
  delay
}: {
  message: LandingHeroConversationMessage
  delay: number
}) {
  return (
    <motion.div variants={msgReveal(delay)} className="flex items-end gap-2">
      <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#a7e26e]/20">
        <div className="size-3 rounded-full bg-[#a7e26e]" />
      </div>
      <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-[#192828] px-3.5 py-2.5">
        <p className="text-[12.5px] leading-normal text-[#e8ede8] sm:text-[13px]">
          {message.text}
        </p>
        <span className="mt-1 block text-right text-[9px] text-[#6f7f80]">
          {message.time}
        </span>
      </div>
    </motion.div>
  )
}

function CustomerConversationMessage({
  message,
  delay
}: {
  message: LandingHeroConversationMessage
  delay: number
}) {
  return (
    <motion.div variants={msgReveal(delay)} className="flex justify-end">
      <div className="max-w-[75%] rounded-2xl rounded-br-md bg-[#a7e26e] px-3.5 py-2.5">
        <p className="text-[12.5px] leading-normal text-[#111918] sm:text-[13px]">
          {message.text}
        </p>
        <div className="mt-1 flex items-center justify-end gap-1">
          <span className="text-[9px] text-[#111918]/50">{message.time}</span>
          <svg
            width="14"
            height="8"
            viewBox="0 0 16 9"
            fill="none"
            stroke="#111918"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.5"
          >
            <polyline points="1 4.5 4 7.5 11 1" />
            <polyline points="5 4.5 8 7.5 15 1" />
          </svg>
        </div>
      </div>
    </motion.div>
  )
}

/* ── ticker items ─────────────────────────────────────── */
const TICKER_ITEMS = [
  'WhatsApp Auto-Reply',
  'Instagram DMs',
  'AI-Powered Chat',
  '24/7 Availability',
  'Smart Routing',
  'Multi-Language',
  'Custom Branding'
]

/* ── heading words ───────────────────────────────────── */
const LINE_1 = ['Build', 'Agents']
const LINE_2 = ['for', 'Vibing']
const LINE_3 = ['with', 'People']

/* ── component ─────────────────────────────────────────── */
export function LandingHero() {
  return (
    <section className="relative flex min-h-dvh flex-col overflow-hidden bg-[#111918]">
      {/* ══════════════════════════════════════════════════
          DIAGONAL AURORA STREAK
          ══════════════════════════════════════════════════ */}
      <motion.div
        className="pointer-events-none absolute inset-0"
        variants={streakReveal}
        initial="hidden"
        animate="visible"
      >
        <div
          className="absolute left-1/2 top-1/2 h-[140%] w-[160%]"
          style={{ transform: 'translate(-50%, -50%) rotate(-25deg)' }}
        >
          {/* Grid inside streak */}
          <div
            className="absolute inset-0 opacity-[0.05]"
            style={{
              backgroundImage:
                'linear-gradient(rgba(167,226,110,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(167,226,110,0.6) 1px, transparent 1px)',
              backgroundSize: '48px 48px',
              maskImage:
                'linear-gradient(to bottom, transparent 25%, black 40%, black 60%, transparent 75%)',
              WebkitMaskImage:
                'linear-gradient(to bottom, transparent 25%, black 40%, black 60%, transparent 75%)'
            }}
          />
          {/* Core glow */}
          <motion.div
            className="absolute left-[10%] right-[10%] top-[42%] h-[16%]"
            animate={auroraFloat1}
          >
            <div
              className="h-full w-full rounded-full opacity-60"
              style={{
                background:
                  'radial-gradient(ellipse 80% 100% at 50% 50%, rgba(206,247,158,0.45) 0%, rgba(167,226,110,0.2) 40%, transparent 70%)',
                filter: 'blur(40px)'
              }}
            />
          </motion.div>
          {/* Outer halo */}
          <motion.div
            className="absolute left-[5%] right-[5%] top-[38%] h-[24%]"
            animate={auroraFloat2}
          >
            <div
              className="h-full w-full rounded-full opacity-40"
              style={{
                background:
                  'radial-gradient(ellipse 70% 100% at 50% 50%, rgba(167,226,110,0.3) 0%, rgba(167,226,110,0.08) 50%, transparent 75%)',
                filter: 'blur(60px)'
              }}
            />
          </motion.div>
          {/* Edge diffusion */}
          <motion.div
            className="absolute inset-x-0 top-[33%] h-[34%]"
            animate={auroraFloat3}
          >
            <div
              className="h-full w-full rounded-full opacity-25"
              style={{
                background:
                  'radial-gradient(ellipse 60% 100% at 50% 50%, rgba(167,226,110,0.2) 0%, transparent 80%)',
                filter: 'blur(80px)'
              }}
            />
          </motion.div>
          {/* Hot spots */}
          <motion.div
            className="absolute left-[20%] top-[46%] h-[8%] w-[15%]"
            animate={{
              opacity: [0.4, 0.8, 0.4] as number[],
              scale: [1, 1.15, 1] as number[],
              transition: {
                duration: 6,
                repeat: Infinity,
                ease: 'easeInOut' as const
              }
            }}
          >
            <div
              className="h-full w-full rounded-full"
              style={{
                background:
                  'radial-gradient(circle, rgba(255,255,255,0.3) 0%, rgba(206,247,158,0.15) 40%, transparent 70%)',
                filter: 'blur(25px)'
              }}
            />
          </motion.div>
          <motion.div
            className="absolute right-[25%] top-[44%] h-[10%] w-[18%]"
            animate={{
              opacity: [0.3, 0.7, 0.3] as number[],
              scale: [1, 1.2, 1] as number[],
              transition: {
                duration: 8,
                repeat: Infinity,
                ease: 'easeInOut' as const,
                delay: 3
              }
            }}
          >
            <div
              className="h-full w-full rounded-full"
              style={{
                background:
                  'radial-gradient(circle, rgba(255,255,255,0.2) 0%, rgba(206,247,158,0.1) 45%, transparent 70%)',
                filter: 'blur(30px)'
              }}
            />
          </motion.div>
        </div>
      </motion.div>

      {/* ══════════════════════════════════════════════════
          TWO-COLUMN CONTENT
          ══════════════════════════════════════════════════ */}
      <div className="relative z-10 mx-auto flex flex-1 max-w-[1400px] items-center px-6 pt-24 sm:px-10 lg:px-16">
        <div className="grid w-full grid-cols-1 items-center gap-10 lg:grid-cols-[1fr_1fr] lg:gap-6 xl:gap-10">
          {/* ── LEFT: text + CTA ── */}
          <div className="relative z-20 text-center lg:text-left">
            <motion.p
              variants={fadeUp(0)}
              initial="hidden"
              animate="visible"
              className="mb-5 font-mono text-[11px] uppercase tracking-[0.2em] text-[#cef79e] sm:mb-6"
            >
              Engineering Better Conversations
            </motion.p>

            <h1 className="mb-10 font-switzer text-[clamp(2.8rem,9vw,5.6rem)] font-extrabold leading-[1] tracking-[-0.045em] text-white sm:mb-12 lg:text-[clamp(3.2rem,5.2vw,5.6rem)]">
              <span className="block">
                {LINE_1.map((word, i) => (
                  <motion.span
                    key={word}
                    className="mr-[0.28em] inline-block"
                    custom={i}
                    variants={wordReveal}
                    initial="hidden"
                    animate="visible"
                  >
                    {word}
                  </motion.span>
                ))}
              </span>
              <span className="mt-1 block">
                {LINE_2.map((word, i) => (
                  <motion.span
                    key={word}
                    className={`mr-[0.28em] inline-block ${
                      word === 'Vibing'
                        ? 'bg-gradient-to-r from-[#a7e26e] to-[#cef79e] bg-clip-text text-transparent'
                        : ''
                    }`}
                    custom={i + LINE_1.length}
                    variants={wordReveal}
                    initial="hidden"
                    animate="visible"
                  >
                    {word}
                  </motion.span>
                ))}
              </span>
              <span className="mt-1 block">
                {LINE_3.map((word, i) => (
                  <motion.span
                    key={word}
                    className="mr-[0.28em] inline-block"
                    custom={i + LINE_1.length + LINE_2.length}
                    variants={wordReveal}
                    initial="hidden"
                    animate="visible"
                  >
                    {word}
                  </motion.span>
                ))}
              </span>
            </h1>

            <motion.div
              variants={fadeUp(0.9)}
              initial="hidden"
              animate="visible"
              className="flex flex-col items-center gap-5 lg:items-start"
            >
              <Button
                asChild
                className="border-white/15 bg-white px-10 py-[22px] text-[13px] font-semibold text-[#111918] shadow-none transition-all duration-300 hover:bg-[#cef79e] hover:text-[#111918] hover:shadow-[0_0_40px_rgba(167,226,110,0.2)] sm:px-14 sm:py-7 sm:text-[14px]"
              >
                <Link href="/sign-in">Get Started</Link>
              </Button>
              <p className="max-w-[360px] text-[15px] font-medium leading-relaxed text-[#dbe8dd]/80 sm:text-[16px]">
                {LANDING_HERO_TAGLINE}
              </p>
            </motion.div>
          </div>

          {/* ── RIGHT: phone mockup ── */}
          <motion.div
            className="relative flex justify-center lg:justify-end"
            initial="hidden"
            animate="visible"
            variants={phoneEntry}
          >
            <motion.div
              className="relative w-[300px] xs:w-[330px] sm:w-[360px] md:w-[380px] lg:w-[350px] xl:w-[390px]"
              animate={phoneFloat}
            >
              {/* Orbital rings + particles — centered on phone */}
              <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                <div className="relative h-[500px] w-[500px] sm:h-[580px] sm:w-[580px] lg:h-[640px] lg:w-[640px]">
                  {/* Outer ring — slow spin */}
                  <motion.div
                    className="absolute inset-0 rounded-full border border-[#a7e26e]/10"
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1, rotate: 360 }}
                    transition={{
                      opacity: { duration: 1, delay: 0.2 },
                      scale: { duration: 1.4, delay: 0.2, ease: springEase },
                      rotate: {
                        duration: 90,
                        repeat: Infinity,
                        ease: 'linear' as const
                      }
                    }}
                  >
                    {/* Dot on outer ring */}
                    <div className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-[#a7e26e]/40" />
                    <div className="absolute -bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-[#a7e26e]/25" />
                  </motion.div>

                  {/* Middle ring — dashed, reverse spin */}
                  <motion.div
                    className="absolute inset-[18%] rounded-full border border-dashed border-[#a7e26e]/[0.07]"
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1, rotate: -360 }}
                    transition={{
                      opacity: { duration: 1, delay: 0.4 },
                      scale: { duration: 1.4, delay: 0.4, ease: springEase },
                      rotate: {
                        duration: 120,
                        repeat: Infinity,
                        ease: 'linear' as const
                      }
                    }}
                  >
                    <div className="absolute left-0 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#cef79e]/30" />
                  </motion.div>

                  {/* Inner ring — subtle glow */}
                  <motion.div
                    className="absolute inset-[36%] rounded-full border border-[#a7e26e]/[0.06]"
                    initial={{ opacity: 0, scale: 0.4 }}
                    animate={{ opacity: 1, scale: 1, rotate: 360 }}
                    transition={{
                      opacity: { duration: 1, delay: 0.6 },
                      scale: { duration: 1.4, delay: 0.6, ease: springEase },
                      rotate: {
                        duration: 70,
                        repeat: Infinity,
                        ease: 'linear' as const
                      }
                    }}
                  >
                    <div className="absolute right-0 top-1/2 h-2 w-2 -translate-y-1/2 translate-x-1/2 rounded-full bg-[#a7e26e]/35 shadow-[0_0_8px_rgba(167,226,110,0.3)]" />
                  </motion.div>

                  {/* Center glow */}
                  <div
                    className="absolute inset-[30%] rounded-full"
                    style={{
                      background:
                        'radial-gradient(circle, rgba(167,226,110,0.06) 0%, transparent 70%)'
                    }}
                  />

                  {/* Floating particles */}
                  <motion.div
                    className="absolute left-[12%] top-[20%] h-1 w-1 rounded-full bg-[#a7e26e]/30"
                    animate={{
                      y: [0, -8, 0] as number[],
                      opacity: [0.2, 0.5, 0.2] as number[]
                    }}
                    transition={{
                      duration: 4,
                      repeat: Infinity,
                      ease: 'easeInOut' as const
                    }}
                  />
                  <motion.div
                    className="absolute right-[15%] top-[30%] h-1.5 w-1.5 rounded-full bg-[#cef79e]/20"
                    animate={{
                      y: [0, 10, 0] as number[],
                      opacity: [0.15, 0.4, 0.15] as number[]
                    }}
                    transition={{
                      duration: 5,
                      repeat: Infinity,
                      ease: 'easeInOut' as const,
                      delay: 1
                    }}
                  />
                  <motion.div
                    className="absolute bottom-[18%] left-[22%] h-1 w-1 rounded-full bg-[#a7e26e]/25"
                    animate={{
                      y: [0, -6, 0] as number[],
                      x: [0, 4, 0] as number[],
                      opacity: [0.2, 0.45, 0.2] as number[]
                    }}
                    transition={{
                      duration: 6,
                      repeat: Infinity,
                      ease: 'easeInOut' as const,
                      delay: 2
                    }}
                  />
                  <motion.div
                    className="absolute bottom-[25%] right-[10%] h-1 w-1 rounded-full bg-[#cef79e]/30"
                    animate={{
                      y: [0, 7, 0] as number[],
                      opacity: [0.25, 0.5, 0.25] as number[]
                    }}
                    transition={{
                      duration: 3.5,
                      repeat: Infinity,
                      ease: 'easeInOut' as const,
                      delay: 0.5
                    }}
                  />
                  <motion.div
                    className="absolute left-[45%] top-[8%] h-[3px] w-[3px] rounded-full bg-[#a7e26e]/20"
                    animate={{
                      y: [0, -10, 0] as number[],
                      opacity: [0.1, 0.35, 0.1] as number[]
                    }}
                    transition={{
                      duration: 5.5,
                      repeat: Infinity,
                      ease: 'easeInOut' as const,
                      delay: 3
                    }}
                  />
                </div>
              </div>

              {/* Phone frame */}
              <div className="relative rounded-[2.8rem] border-[7px] border-[#1e3233] bg-[#1e3233] shadow-[0_30px_80px_rgba(0,0,0,0.5)] sm:rounded-[3rem]">
                {/* Side buttons */}
                <div className="absolute -right-[9px] top-[100px] h-[40px] w-[4px] rounded-r-[2px] bg-[#253f40]" />
                <div className="absolute -left-[9px] top-[85px] h-[26px] w-[4px] rounded-l-[2px] bg-[#253f40]" />
                <div className="absolute -left-[9px] top-[122px] h-[48px] w-[4px] rounded-l-[2px] bg-[#253f40]" />
                <div className="absolute -left-[9px] top-[182px] h-[48px] w-[4px] rounded-l-[2px] bg-[#253f40]" />

                {/* Screen */}
                <div className="relative overflow-hidden rounded-[2.2rem] bg-[#0e1514] sm:rounded-[2.4rem]">
                  {/* App header */}
                  <div className="flex items-center gap-3 bg-[#1e3233] px-5 pb-3 pt-8 sm:px-6 sm:pt-10">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#a7e26e]">
                      <svg
                        width="17"
                        height="17"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#111918"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                    </div>
                    <span className="font-sans text-[15px] font-bold text-white">
                      VibeAgent
                    </span>
                  </div>

                  {/* Screen body — chat conversation */}
                  <div className="h-px bg-gradient-to-r from-transparent via-[#253435] to-transparent" />

                  <motion.div
                    className="space-y-2.5 px-3 py-4 sm:px-4"
                    initial="hidden"
                    animate="visible"
                  >
                    {/* Timestamp */}
                    <motion.div
                      variants={msgReveal(0.8)}
                      className="text-center"
                    >
                      <span className="rounded-full bg-[#192828] px-3 py-1 text-[9px] font-medium text-[#6f7f80]">
                        Today, 9:41 AM
                      </span>
                    </motion.div>

                    {LANDING_HERO_CONVERSATION.map((message, index) =>
                      message.role === 'agent' ? (
                        <AgentConversationMessage
                          key={message.id}
                          message={message}
                          delay={1 + index * 0.5}
                        />
                      ) : (
                        <CustomerConversationMessage
                          key={message.id}
                          message={message}
                          delay={1 + index * 0.5}
                        />
                      )
                    )}
                  </motion.div>

                  {/* Input bar */}
                  <motion.div
                    className="flex items-center gap-2 border-t border-[#1e2f30] px-3 py-2.5 sm:px-4"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.5, delay: 0.6 }}
                  >
                    <div className="flex h-8 w-8 items-center justify-center text-white/40">
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                        <line x1="9" y1="9" x2="9.01" y2="9" />
                        <line x1="15" y1="9" x2="15.01" y2="9" />
                      </svg>
                    </div>
                    <div className="flex-1 rounded-full bg-[#192828] px-4 py-2">
                      <p className="text-[11px] text-[#6f7f80]">
                        Type a message…
                      </p>
                    </div>
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#a7e26e]">
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#111918"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <line x1="22" y1="2" x2="11" y2="13" />
                        <polygon points="22 2 15 22 11 13 2 9 22 2" />
                      </svg>
                    </div>
                  </motion.div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════
          SCROLLING TICKER
          ══════════════════════════════════════════════════ */}
      <motion.div
        className="relative z-10 border-t border-[#1a2829] py-6 sm:py-8"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 1.5 }}
      >
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-[#111918] to-transparent sm:w-40" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-[#111918] to-transparent sm:w-40" />

        <div className="flex overflow-hidden">
          <div className="animate-marquee flex shrink-0 items-center gap-8 sm:gap-12">
            {[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, i) => (
              <div
                key={`a-${i}`}
                className="flex shrink-0 items-center gap-2.5 whitespace-nowrap"
              >
                <div className="h-1.5 w-1.5 rounded-full bg-[#a7e26e]" />
                <span className="font-mono text-[12px] uppercase tracking-[0.12em] text-[#6f7f80] sm:text-[13px]">
                  {item}
                </span>
              </div>
            ))}
          </div>
          <div
            className="animate-marquee flex shrink-0 items-center gap-8 sm:gap-12"
            aria-hidden
          >
            {[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, i) => (
              <div
                key={`b-${i}`}
                className="flex shrink-0 items-center gap-2.5 whitespace-nowrap"
              >
                <div className="h-1.5 w-1.5 rounded-full bg-[#a7e26e]" />
                <span className="font-mono text-[12px] uppercase tracking-[0.12em] text-[#6f7f80] sm:text-[13px]">
                  {item}
                </span>
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </section>
  )
}
