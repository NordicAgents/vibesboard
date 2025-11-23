'use client'

import Link from 'next/link'
import { FadeIn } from './fade-in'

export function LandingFooter() {
    return (
        <footer className="bg-black-primary text-beige-bg py-20 px-6">
            <div className="container mx-auto">
                <div className="flex flex-col md:flex-row justify-between items-start mb-20">
                    <div className="max-w-2xl">
                        <FadeIn delay={0.1}>
                            <h2 className="text-[10vw] leading-[0.9] font-switzer font-bold tracking-tighter mb-8">
                                START VIBING <br /> TODAY
                            </h2>
                        </FadeIn>
                        <FadeIn delay={0.2}>
                            <a href="mailto:hi@vibesboard.com" className="text-2xl md:text-4xl border-b border-white/20 pb-2 hover:text-gray-secondary transition-colors">
                                hi@vibesboard.com
                            </a>
                        </FadeIn>
                    </div>

                    <div className="mt-12 md:mt-0 flex flex-col gap-4">
                        <FadeIn delay={0.3}>
                            <span className="text-sm font-mono text-gray-secondary">[SOCIALS]</span>
                            <div className="flex flex-col gap-2 mt-2">
                                <Link href="https://www.instagram.com/vibesboard_ai/" target="_blank" rel="noopener noreferrer" className="hover:text-gray-secondary transition-colors">Instagram</Link>
                                <Link href="https://x.com/vibesboard_ai" target="_blank" rel="noopener noreferrer" className="hover:text-gray-secondary transition-colors">Twitter</Link>
                                <Link href="https://www.linkedin.com/company/vibesboard-ai/" target="_blank" rel="noopener noreferrer" className="hover:text-gray-secondary transition-colors">LinkedIn</Link>
                                <Link href="https://www.youtube.com/@vibesboard_ai" target="_blank" rel="noopener noreferrer" className="hover:text-gray-secondary transition-colors">YouTube</Link>
                            </div>
                        </FadeIn>
                    </div>
                </div>

                <FadeIn delay={0.4}>
                    <div className="flex flex-col md:flex-row justify-between items-center pt-8 border-t border-white/10 text-sm text-gray-secondary">
                        <p>© 2025 vibesboard. All rights reserved.</p>
                        <div className="flex gap-8 mt-4 md:mt-0">
                            <Link href="#" className="hover:text-white transition-colors">Privacy Policy</Link>
                            <Link href="#" className="hover:text-white transition-colors">Terms of Service</Link>
                        </div>
                    </div>
                </FadeIn>
            </div>
        </footer>
    )
}
