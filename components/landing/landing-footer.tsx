'use client'

import Link from 'next/link'
import { FadeIn } from './fade-in'

export function LandingFooter() {
    return (
        <footer className="safe-area-inset-bottom bg-black-primary px-4 py-12 text-beige-bg sm:px-6 sm:py-16 lg:py-20">
            <div className="container mx-auto">
                <div className="mb-12 flex flex-col items-start justify-between sm:mb-16 md:flex-row lg:mb-20">
                    <div className="w-full max-w-2xl">
                        <FadeIn delay={0.1}>
                            <h2 className="mb-6 font-switzer text-[12vw] font-bold leading-[0.9] tracking-tighter text-beige-bg sm:mb-8 sm:text-[10vw] md:text-[8vw]">
                                START VIBING <br className="hidden sm:block" /> TODAY
                            </h2>
                        </FadeIn>
                        <FadeIn delay={0.2}>
                            <a href="mailto:hi@vibesboard.com" className="inline-block border-b border-white/20 pb-2 text-xl transition-colors hover:text-gray-secondary sm:text-2xl md:text-3xl lg:text-4xl">
                                hi@vibesboard.com
                            </a>
                        </FadeIn>
                    </div>

                    <div className="mt-8 flex flex-col gap-4 sm:mt-12 md:mt-0">
                        <FadeIn delay={0.3}>
                            <span className="font-mono text-xs text-gray-secondary sm:text-sm">[SOCIALS]</span>
                            <div className="mt-2 flex flex-row flex-wrap gap-4 sm:gap-2 md:flex-col">
                                <Link href="https://www.instagram.com/vibesboard_ai/" target="_blank" rel="noopener noreferrer" className="text-sm transition-colors hover:text-gray-secondary sm:text-base">Instagram</Link>
                                <Link href="https://x.com/vibesboard_ai" target="_blank" rel="noopener noreferrer" className="text-sm transition-colors hover:text-gray-secondary sm:text-base">Twitter</Link>
                                <Link href="https://www.linkedin.com/company/vibesboard-ai/" target="_blank" rel="noopener noreferrer" className="text-sm transition-colors hover:text-gray-secondary sm:text-base">LinkedIn</Link>
                                <Link href="https://www.youtube.com/@vibesboard_ai" target="_blank" rel="noopener noreferrer" className="text-sm transition-colors hover:text-gray-secondary sm:text-base">YouTube</Link>
                            </div>
                        </FadeIn>
                    </div>
                </div>

                <FadeIn delay={0.4}>
                    <div className="flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-6 text-xs text-gray-secondary sm:flex-row sm:gap-0 sm:pt-8 sm:text-sm">
                        <p className="text-center sm:text-left">© 2025 vibesboard. All rights reserved.</p>
                        <div className="flex gap-4 sm:gap-8">
                            <Link href="/privacy-policy" className="transition-colors hover:text-white">Privacy Policy</Link>
                            <Link href="/terms-of-service" className="transition-colors hover:text-white">Terms of Service</Link>
                        </div>
                    </div>
                </FadeIn>
            </div>
        </footer>
    )
}
