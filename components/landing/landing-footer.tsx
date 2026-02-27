'use client'

import Link from 'next/link'
import { FadeIn } from './fade-in'

export function LandingFooter() {
    return (
        <footer className="bg-black-primary text-beige-bg py-12 sm:py-16 lg:py-20 px-4 sm:px-6 safe-area-inset-bottom">
            <div className="container mx-auto">
                <div className="flex flex-col md:flex-row justify-between items-start mb-12 sm:mb-16 lg:mb-20">
                    <div className="max-w-2xl w-full">
                        <FadeIn delay={0.1}>
                            <h2 className="text-[12vw] sm:text-[10vw] md:text-[8vw] leading-[0.9] font-switzer font-bold tracking-tighter mb-6 sm:mb-8 text-beige-bg">
                                START VIBING <br className="hidden sm:block" /> TODAY
                            </h2>
                        </FadeIn>
                        <FadeIn delay={0.2}>
                            <a href="mailto:hi@vibesboard.com" className="text-xl sm:text-2xl md:text-3xl lg:text-4xl border-b border-white/20 pb-2 hover:text-gray-secondary transition-colors inline-block">
                                hi@vibesboard.com
                            </a>
                        </FadeIn>
                    </div>

                    <div className="mt-8 sm:mt-12 md:mt-0 flex flex-col gap-4">
                        <FadeIn delay={0.3}>
                            <span className="text-xs sm:text-sm font-mono text-gray-secondary">[SOCIALS]</span>
                            <div className="flex flex-row md:flex-col gap-4 sm:gap-2 mt-2 flex-wrap">
                                <Link href="https://www.instagram.com/vibesboard_ai/" target="_blank" rel="noopener noreferrer" className="hover:text-gray-secondary transition-colors text-sm sm:text-base">Instagram</Link>
                                <Link href="https://x.com/vibesboard_ai" target="_blank" rel="noopener noreferrer" className="hover:text-gray-secondary transition-colors text-sm sm:text-base">Twitter</Link>
                                <Link href="https://www.linkedin.com/company/vibesboard-ai/" target="_blank" rel="noopener noreferrer" className="hover:text-gray-secondary transition-colors text-sm sm:text-base">LinkedIn</Link>
                                <Link href="https://www.youtube.com/@vibesboard_ai" target="_blank" rel="noopener noreferrer" className="hover:text-gray-secondary transition-colors text-sm sm:text-base">YouTube</Link>
                            </div>
                        </FadeIn>
                    </div>
                </div>

                <FadeIn delay={0.4}>
                    <div className="flex flex-col sm:flex-row justify-between items-center pt-6 sm:pt-8 border-t border-white/10 text-xs sm:text-sm text-gray-secondary gap-4 sm:gap-0">
                        <p className="text-center sm:text-left">© 2025 vibesboard. All rights reserved.</p>
                        <div className="flex gap-4 sm:gap-8">
                            <Link href="/privacy-policy" className="hover:text-white transition-colors">Privacy Policy</Link>
                            <Link href="/terms-of-service" className="hover:text-white transition-colors">Terms of Service</Link>
                        </div>
                    </div>
                </FadeIn>
            </div>
        </footer>
    )
}
