'use client'

import { useEffect } from 'react'
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform
} from 'framer-motion'

import { cn } from '@/lib/utils'

export function LandingHeroBackground() {
  const shouldReduceMotion = useReducedMotion()

  const pointerX = useMotionValue(0)
  const pointerY = useMotionValue(0)

  const smoothX = useSpring(pointerX, {
    stiffness: 60,
    damping: 20,
    mass: 0.7
  })
  const smoothY = useSpring(pointerY, {
    stiffness: 60,
    damping: 20,
    mass: 0.7
  })

  const sceneX = useTransform(smoothX, value => value * -10)
  const sceneY = useTransform(smoothY, value => value * -8)
  const sceneRotate = useTransform(smoothX, value => value * -1.2)

  const orbAX = useTransform(smoothX, value => value * -20)
  const orbAY = useTransform(smoothY, value => value * -16)
  const orbBX = useTransform(smoothX, value => value * 16)
  const orbBY = useTransform(smoothY, value => value * 14)
  const orbCX = useTransform(smoothX, value => value * 9)
  const orbCY = useTransform(smoothY, value => value * -10)
  const hazeX = useTransform(smoothX, value => value * -14)
  const hazeY = useTransform(smoothY, value => value * 12)
  const ribbonX = useTransform(smoothX, value => value * -8)
  const ribbonY = useTransform(smoothY, value => value * 6)
  const sheenX = useTransform(smoothX, value => value * 22)
  const sheenY = useTransform(smoothY, value => value * -8)
  const flareX = useTransform(smoothX, value => value * 14)
  const flareY = useTransform(smoothY, value => value * -14)

  useEffect(() => {
    if (shouldReduceMotion) {
      pointerX.set(0)
      pointerY.set(0)
      return
    }

    const finePointer = window.matchMedia('(pointer: fine)')
    if (!finePointer.matches) {
      pointerX.set(0)
      pointerY.set(0)
      return
    }

    const handlePointerMove = (event: PointerEvent) => {
      const normalizedX = (event.clientX / window.innerWidth - 0.5) * 2
      const normalizedY = (event.clientY / window.innerHeight - 0.5) * 2

      pointerX.set(normalizedX)
      pointerY.set(normalizedY)
    }

    const resetPointer = () => {
      pointerX.set(0)
      pointerY.set(0)
    }

    const handleMouseOut = (event: MouseEvent) => {
      if (!event.relatedTarget) {
        resetPointer()
      }
    }

    window.addEventListener('pointermove', handlePointerMove, { passive: true })
    window.addEventListener('blur', resetPointer)
    window.addEventListener('mouseout', handleMouseOut)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('blur', resetPointer)
      window.removeEventListener('mouseout', handleMouseOut)
    }
  }, [pointerX, pointerY, shouldReduceMotion])

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0"
    >
      <motion.div
        initial={
          shouldReduceMotion
            ? false
            : {
                clipPath: 'inset(38% 38% 38% 38% round 6rem)',
                opacity: 0.76,
                scale: 0.94
              }
        }
        animate={{
          clipPath: 'inset(0% 0% 0% 0% round 2rem)',
          opacity: 1,
          scale: 1
        }}
        transition={
          shouldReduceMotion
            ? { duration: 0 }
            : {
                duration: 1.6,
                delay: 0.15,
                ease: [0.22, 1, 0.36, 1]
              }
        }
        className="absolute inset-[8px] overflow-hidden rounded-[24px] border border-white/25 shadow-[0_24px_80px_rgba(20,24,21,0.24)] sm:inset-[12px] sm:rounded-[32px]"
        style={{
          willChange: shouldReduceMotion
            ? 'auto'
            : 'clip-path, transform, opacity'
        }}
      >
        <div className="absolute inset-0 bg-[linear-gradient(118deg,#879d84_0%,#9cae99_22%,#bfc8ba_52%,#d8d1c7_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_72%_16%,rgba(255,255,255,0.42)_0%,rgba(255,255,255,0.16)_14%,rgba(255,255,255,0)_36%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_88%,rgba(130,160,132,0.38)_0%,rgba(130,160,132,0.14)_20%,rgba(130,160,132,0)_44%)]" />

        <motion.div
          className="absolute inset-[-8%]"
          style={
            shouldReduceMotion
              ? undefined
              : { x: sceneX, y: sceneY, rotate: sceneRotate }
          }
        >
          <motion.div
            className="absolute left-[-12%] top-[-18%] h-[128%] w-[68%]"
            style={shouldReduceMotion ? undefined : { x: orbAX, y: orbAY }}
          >
            <div
              className={cn(
                'size-full rounded-full bg-[radial-gradient(circle_at_42%_30%,rgba(21,88,64,0.86)_0%,rgba(6,53,37,0.98)_18%,rgba(2,28,19,1)_41%,rgba(1,12,9,0.99)_56%,rgba(18,70,50,0.86)_72%,rgba(153,182,157,0)_100%)] opacity-[0.98] blur-[10px]',
                !shouldReduceMotion && 'landing-hero-orb-a'
              )}
            />
          </motion.div>

          <motion.div
            className="absolute left-[-7%] top-[7%] h-[58%] w-[41%]"
            style={shouldReduceMotion ? undefined : { x: flareX, y: flareY }}
          >
            <div
              className={cn(
                'size-full rounded-full bg-[radial-gradient(circle_at_32%_26%,rgba(255,255,255,0.34)_0%,rgba(196,224,199,0.16)_18%,rgba(255,255,255,0)_56%)] opacity-80 blur-[58px]',
                !shouldReduceMotion && 'landing-hero-gloss'
              )}
            />
          </motion.div>

          <motion.div
            className="absolute bottom-[-40%] left-[-7%] h-4/5 w-[58%]"
            style={shouldReduceMotion ? undefined : { x: orbBX, y: orbBY }}
          >
            <div
              className={cn(
                'size-full rounded-full bg-[radial-gradient(circle_at_48%_32%,rgba(18,76,54,0.8)_0%,rgba(4,36,25,0.97)_32%,rgba(1,15,11,0.99)_54%,rgba(92,136,108,0.5)_77%,rgba(153,182,157,0)_100%)] opacity-[0.96] blur',
                !shouldReduceMotion && 'landing-hero-orb-b'
              )}
            />
          </motion.div>

          <motion.div
            className="absolute bottom-[-12%] right-[-5%] h-[54%] w-[36%]"
            style={shouldReduceMotion ? undefined : { x: orbCX, y: orbCY }}
          >
            <div
              className={cn(
                'size-full rounded-full bg-[radial-gradient(circle_at_44%_36%,rgba(13,65,47,0.68)_0%,rgba(3,32,23,0.9)_42%,rgba(1,16,12,0.2)_72%,rgba(255,255,255,0)_100%)] opacity-55 blur-[18px]',
                !shouldReduceMotion && 'landing-hero-orb-c'
              )}
            />
          </motion.div>

          <motion.div
            className="absolute right-[7%] top-[7%] h-[52%] w-[38%]"
            style={shouldReduceMotion ? undefined : { x: hazeX, y: hazeY }}
          >
            <div
              className={cn(
                'size-full rounded-full bg-[radial-gradient(circle,rgba(247,249,244,0.34)_0%,rgba(244,248,242,0.15)_26%,rgba(245,248,242,0)_70%)] blur-[96px]',
                !shouldReduceMotion && 'landing-hero-haze'
              )}
            />
          </motion.div>

          <motion.div
            className="absolute inset-0"
            style={shouldReduceMotion ? undefined : { x: ribbonX, y: ribbonY }}
          >
            <div
              className={cn(
                'absolute inset-0',
                !shouldReduceMotion && 'landing-hero-ribbon-drift'
              )}
            >
              <div className="absolute left-[10%] top-[33%] h-[26%] w-[98%] rotate-[15deg] rounded-full bg-[linear-gradient(180deg,rgba(249,242,234,0.98)_0%,rgba(189,135,91,0.92)_18%,rgba(86,48,24,0.94)_44%,rgba(227,218,207,0.9)_71%,rgba(125,78,45,0.94)_100%)] opacity-[0.88] shadow-[0_18px_40px_rgba(76,44,20,0.18)]" />
              <div className="absolute left-[11%] top-[36.6%] h-[19%] w-[96%] rotate-[15deg] rounded-full border-2 border-[#f6efe6]/80 opacity-95" />
              <div className="absolute left-[10.7%] top-[38.5%] h-[16%] w-[95.5%] rotate-[15deg] rounded-full border border-[rgba(58,34,18,0.64)] opacity-85" />
              <div className="opacity-78 absolute left-[6%] top-[55%] h-1/5 w-[64%] rotate-[-44deg] rounded-full border-2 border-white/60" />
              <div className="absolute left-[4.8%] top-[52.7%] h-[21%] w-[65%] rotate-[-44deg] rounded-full border border-[rgba(116,78,47,0.68)] opacity-70" />
              <div className="absolute left-[24%] top-[41%] h-[10%] w-[70%] rotate-[15deg] rounded-full bg-[linear-gradient(90deg,rgba(255,255,255,0)_0%,rgba(255,255,255,0.48)_38%,rgba(255,255,255,0.08)_58%,rgba(255,255,255,0)_100%)] opacity-55 blur-[10px]" />
            </div>
          </motion.div>

          <motion.div
            className="absolute left-[-14%] top-[12%] h-[74%] w-[82%]"
            style={shouldReduceMotion ? undefined : { x: sheenX, y: sheenY }}
          >
            <div
              className={cn(
                'size-full bg-[linear-gradient(110deg,rgba(255,255,255,0)_18%,rgba(255,255,255,0.18)_35%,rgba(243,247,240,0.08)_50%,rgba(255,255,255,0)_65%)] opacity-40 mix-blend-screen blur-[46px]',
                !shouldReduceMotion && 'landing-hero-sheen'
              )}
            />
          </motion.div>

          <div className="absolute inset-0 bg-[radial-gradient(circle_at_28%_34%,rgba(255,255,255,0.22)_0%,rgba(255,255,255,0.06)_11%,rgba(255,255,255,0)_28%)] mix-blend-screen" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_78%_56%,rgba(255,255,255,0.14)_0%,rgba(255,255,255,0.04)_10%,rgba(255,255,255,0)_24%)] mix-blend-screen" />
        </motion.div>

        <div className="absolute inset-0 opacity-[0.055] mix-blend-soft-light [background-image:radial-gradient(rgba(255,255,255,0.68)_0.8px,transparent_0.8px)] [background-size:13px_13px]" />
        <div
          className={cn(
            'absolute inset-0 opacity-5 [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:128px_128px]',
            !shouldReduceMotion && 'landing-hero-grid-drift'
          )}
        />

        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(7,17,12,0.18)_0%,rgba(7,17,12,0.05)_36%,rgba(255,255,255,0)_64%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0)_38%,rgba(28,36,31,0.06)_72%,rgba(11,16,13,0.18)_100%)]" />
      </motion.div>
    </div>
  )
}
