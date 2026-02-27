'use client'

import { ArrowUpRight } from 'lucide-react'
import { FadeIn } from './fade-in'

const services = [
    {
        id: "01",
        title: "Agent Building",
        description: "Create custom AI agents with unique personalities. Design agents that represent you and interact authentically with your audience."
    },
    {
        id: "02",
        title: "Vibe Recording",
        description: "Capture every conversation and interaction automatically. Never miss a moment—all vibes are saved and ready for review."
    },
    {
        id: "03",
        title: "AI Analysis",
        description: "Discover the real vibe from people using AI-powered insights. Understand sentiment, engagement, and authentic reactions."
    },
    {
        id: "04",
        title: "Community Sharing",
        description: "Share your agents with the world. Let others vibe with your creations and build a community around your AI personalities."
    }
]

export function LandingServices() {
    return (
        <section id="services" className="border-black-primary/5 border-t bg-beige-bg px-4 py-12 dark:border-white/5 dark:bg-background sm:px-6 sm:py-16 lg:py-20">
            <div className="container mx-auto">
                <div className="mb-8 flex flex-col items-start justify-between sm:mb-12 md:flex-row lg:mb-16">
                    <FadeIn delay={0.1}>
                        <h2 className="font-mono text-xs text-gray-secondary sm:text-sm">[02] CAPABILITIES</h2>
                    </FadeIn>
                </div>

                <div className="grid grid-cols-1 gap-0">
                    {services.map((service, index) => (
                        <FadeIn key={service.id} delay={0.1 + (index * 0.1)} direction="left">
                            <div className="border-black-primary/10 group cursor-default border-t py-6 transition-colors hover:bg-white/50 dark:border-white/10 dark:hover:bg-white/5 sm:py-8 lg:py-12">
                                <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center sm:gap-4">
                                    <div className="flex items-baseline gap-4 sm:gap-6 lg:gap-8">
                                        <span className="font-mono text-xs text-gray-secondary sm:text-sm">{service.id}</span>
                                        <h3 className="font-switzer text-xl font-medium dark:text-foreground sm:text-2xl md:text-3xl lg:text-4xl xl:text-5xl">{service.title}</h3>
                                    </div>
                                    <div className="flex w-full items-center justify-end gap-4 sm:w-auto sm:gap-6 lg:gap-8">
                                        <p className="hidden max-w-xs text-sm text-gray-secondary opacity-0 transition-opacity duration-500 group-hover:opacity-100 lg:block">
                                            {service.description}
                                        </p>
                                        <div className="border-black-primary/20 flex size-8 shrink-0 items-center justify-center rounded-full border transition-all duration-300 group-hover:bg-black-primary group-hover:text-white dark:border-white/20 dark:group-hover:bg-white dark:group-hover:text-black sm:size-10">
                                            <ArrowUpRight className="size-4 sm:size-5" />
                                        </div>
                                    </div>
                                </div>
                                {/* Mobile description below title */}
                                <p className="mt-2 pl-8 text-sm text-gray-secondary sm:pl-10 lg:hidden">
                                    {service.description}
                                </p>
                            </div>
                        </FadeIn>
                    ))}
                    <div className="border-black-primary/10 border-t dark:border-white/10"></div>
                </div>
            </div>
        </section>
    )
}
