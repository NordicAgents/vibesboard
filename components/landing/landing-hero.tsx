'use client'

import { FadeIn } from './fade-in'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

export function LandingHero() {
    return (
        <section className="relative min-h-[100dvh] flex items-center justify-center overflow-hidden pt-16 sm:pt-20">
            {/* Background Image with Overlay */}
            <div className="absolute inset-0 z-0">
                <img
                    src="/images/landing/hero-bg.png"
                    alt="Hero background"
                    className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-black/40"></div>
            </div>

            {/* Content */}
            <div className="container mx-auto px-4 sm:px-6 lg:px-8 z-10 relative">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-center">
                    {/* Left Side - Main Headline */}
                    <div className="text-center lg:text-left">
                        <FadeIn delay={0.2}>
                            <h1 className="font-switzer font-bold text-[clamp(2rem,8vw,5rem)] lg:text-[clamp(3rem,6vw,5.5rem)] leading-[1.1] lg:leading-[0.95] tracking-tight text-white mb-6 sm:mb-8">
                                Build Agents for Vibing with People
                            </h1>
                        </FadeIn>
                        <FadeIn delay={0.4}>
                            <Button
                                asChild
                                className="rounded-full bg-white text-black-primary hover:bg-white/90 px-6 sm:px-8 py-5 sm:py-6 text-base sm:text-lg font-medium"
                            >
                                <Link href="/sign-in">GET STARTED</Link>
                            </Button>
                        </FadeIn>
                    </div>

                    {/* Right Side - Description */}
                    <div className="lg:ml-auto max-w-md mx-auto lg:mx-0 text-center lg:text-left">
                        <FadeIn delay={0.5}>
                            <p className="text-white/90 text-base sm:text-lg leading-relaxed">
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
                className="absolute bottom-6 sm:bottom-10 left-1/2 -translate-x-1/2 z-10 hidden sm:block"
            >
                <div className="w-[1px] h-12 sm:h-16 bg-white/20 overflow-hidden">
                    <motion.div
                        animate={{ y: ["-100%", "100%"] }}
                        transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                        className="w-full h-1/2 bg-white"
                    ></motion.div>
                </div>
            </motion.div>
        </section>
    )
}
