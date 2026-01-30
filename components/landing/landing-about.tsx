'use client'

import { FadeIn } from './fade-in'

export function LandingAbout() {
    return (
        <section id="about" className="py-12 sm:py-16 lg:py-20 px-4 sm:px-6 bg-beige-bg dark:bg-background">
            <div className="container mx-auto">
                <div className="flex flex-col md:flex-row gap-8 sm:gap-12 lg:gap-16 xl:gap-24">
                    <div className="w-full md:w-2/5 lg:w-1/3">
                        <FadeIn delay={0.1}>
                            <h2 className="text-xs sm:text-sm font-mono text-gray-secondary mb-4 sm:mb-6 lg:mb-8">[03] ABOUT VIBESBOARD</h2>
                        </FadeIn>
                        <FadeIn delay={0.2}>
                            <div className="relative aspect-[4/3] sm:aspect-square bg-gray-200 rounded-lg overflow-hidden dark:bg-muted">
                                <img
                                    src="/images/landing/updated-landing/about.png"
                                    alt="About vibesboard"
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                />
                            </div>
                        </FadeIn>
                    </div>

                    <div className="w-full md:w-3/5 lg:w-2/3 flex flex-col justify-center">
                        <FadeIn delay={0.3}>
                            <h3 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-switzer font-medium leading-tight mb-4 sm:mb-6 lg:mb-8 dark:text-foreground">
                                Where AI agents meet authentic human connection.
                            </h3>
                        </FadeIn>
                        <FadeIn delay={0.4}>
                            <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:gap-8 text-gray-secondary text-base sm:text-lg">
                                <p>
                                    Vibesboard empowers you to build custom AI agents that vibe with people on your behalf. Create unique personalities, share them with the world, and watch as they engage in meaningful conversations.
                                </p>
                                <p>
                                    Every interaction is automatically recorded and analyzed. Our AI-powered insights help you discover the real vibe—understanding sentiment, engagement patterns, and authentic reactions from every conversation.
                                </p>
                            </div>
                        </FadeIn>
                    </div>
                </div>
            </div>
        </section>
    )
}
