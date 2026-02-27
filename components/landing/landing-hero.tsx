'use client'

import { FadeIn } from './fade-in'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import Image from 'next/image'

export function LandingHero() {
    return (
        <section className="relative flex min-h-dvh items-center justify-center overflow-hidden pt-16 sm:pt-20">
            {/* Background Image with Overlay */}
            <div className="absolute inset-0 z-0">
                <Image
                    src="/images/landing/hero-bg.png"
                    alt="Hero background"
                    fill
                    className="object-cover"
                    priority
                />
                <div className="absolute inset-0 bg-black/40"></div>
            </div>

            {/* Content */}
            <div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8">
                <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-2 lg:gap-12">
                    {/* Left Side - Main Headline */}
                    <div className="text-center lg:text-left">
                        <FadeIn delay={0.2}>
                            <h1 className="mb-6 font-switzer text-[clamp(2rem,8vw,5rem)] font-bold leading-[1.1] tracking-tight text-white sm:mb-8 lg:text-[clamp(3rem,6vw,5.5rem)] lg:leading-[0.95]">
                                Build Agents for Vibing with People
                            </h1>
                        </FadeIn>
                        <FadeIn delay={0.4}>
                            <Button
                                asChild
                                className="rounded-full bg-white px-6 py-5 text-base font-medium text-black-primary hover:bg-white/90 sm:px-8 sm:py-6 sm:text-lg"
                            >
                                <Link href="/sign-in">GET STARTED</Link>
                            </Button>
                        </FadeIn>
                    </div>

                    {/* Right Side - Description */}
                    <div className="mx-auto max-w-md text-center lg:mx-0 lg:ml-auto lg:text-left">
                        <FadeIn delay={0.5}>
                            <p className="text-base leading-relaxed text-white/90 sm:text-lg">
                                Build custom agents and share them to vibe with people. All interactions are recorded, and you can discover the real vibe from people using AI-powered insights.
                            </p>
                        </FadeIn>
                    </div>
                </div>
            </div>

            {/* Scroll Indicator - Hidden on small mobile */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.5, duration: 1 }}
                className="absolute bottom-6 left-1/2 z-10 hidden -translate-x-1/2 sm:bottom-10 sm:block"
            >
                <div className="h-12 w-px overflow-hidden bg-white/20 sm:h-16">
                    <motion.div
                        animate={{ y: ["-100%", "100%"] }}
                        transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                        className="h-1/2 w-full bg-white"
                    ></motion.div>
                </div>
            </motion.div>
        </section>
    )
}
