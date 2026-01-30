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
        <section id="services" className="py-20 px-6 bg-beige-bg border-t border-black-primary/5 dark:bg-background dark:border-white/5">
            <div className="container mx-auto">
                <div className="flex flex-col md:flex-row justify-between items-start mb-16">
                    <FadeIn delay={0.1}>
                        <h2 className="text-sm font-mono text-gray-secondary mb-4 md:mb-0">[02] CAPABILITIES</h2>
                    </FadeIn>
                </div>

                <div className="grid grid-cols-1 gap-0">
                    {services.map((service, index) => (
                        <FadeIn key={service.id} delay={0.1 + (index * 0.1)} direction="left">
                            <div className="group border-t border-black-primary/10 py-12 transition-colors hover:bg-white/50 cursor-default dark:border-white/10 dark:hover:bg-white/5">
                                <div className="flex flex-col md:flex-row justify-between items-start md:items-center">
                                    <div className="flex items-baseline gap-8 mb-4 md:mb-0">
                                        <span className="font-mono text-sm text-gray-secondary">{service.id}</span>
                                        <h3 className="text-3xl md:text-5xl font-switzer font-medium dark:text-foreground">{service.title}</h3>
                                    </div>
                                    <div className="flex items-center gap-8">
                                        <p className="hidden md:block text-gray-secondary max-w-xs text-sm opacity-0 group-hover:opacity-100 transition-opacity duration-500">
                                            {service.description}
                                        </p>
                                        <div className="w-10 h-10 rounded-full border border-black-primary/20 flex items-center justify-center group-hover:bg-black-primary group-hover:text-white transition-all duration-300 dark:border-white/20 dark:group-hover:bg-white dark:group-hover:text-black">
                                            <ArrowUpRight className="w-5 h-5" />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </FadeIn>
                    ))}
                    <div className="border-t border-black-primary/10 dark:border-white/10"></div>
                </div>
            </div>
        </section>
    )
}
