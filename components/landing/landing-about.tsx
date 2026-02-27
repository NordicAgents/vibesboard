'use client'

import { FadeIn } from './fade-in'

export function LandingAbout() {
    return (
        <section id="about" className="bg-beige-bg px-4 py-12 dark:bg-background sm:px-6 sm:py-16 lg:py-20">
            <div className="container mx-auto">
                <div className="flex flex-col gap-8 sm:gap-12 md:flex-row lg:gap-16 xl:gap-24">
                    <div className="w-full md:w-2/5 lg:w-1/3">
                        <FadeIn delay={0.1}>
                            <h2 className="mb-4 font-mono text-xs text-gray-secondary sm:mb-6 sm:text-sm lg:mb-8">[03] ABOUT VIBESBOARD</h2>
                        </FadeIn>
                        <FadeIn delay={0.2}>
                            <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-gray-200 dark:bg-muted sm:aspect-square">
                                <img
                                    src="/images/landing/updated-landing/about.png"
                                    alt="About vibesboard"
                                    className="size-full object-cover"
                                    loading="lazy"
                                />
                            </div>
                        </FadeIn>
                    </div>

                    <div className="flex w-full flex-col justify-center md:w-3/5 lg:w-2/3">
                        <FadeIn delay={0.3}>
                            <h3 className="mb-4 font-switzer text-2xl font-medium leading-tight dark:text-foreground sm:mb-6 sm:text-3xl md:text-4xl lg:mb-8 lg:text-5xl">
                                Where AI agents meet authentic human connection.
                            </h3>
                        </FadeIn>
                        <FadeIn delay={0.4}>
                            <div className="grid grid-cols-1 gap-4 text-base text-gray-secondary sm:gap-6 sm:text-lg lg:gap-8">
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
