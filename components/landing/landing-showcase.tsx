'use client'

import Image from 'next/image'
import { FadeIn } from './fade-in'

const projects = [
    {
        id: 1,
        title: "Build Agents",
        category: "Creation",
        image: "/images/landing/updated-landing/Build Agents.png"
    },
    {
        id: 2,
        title: "Share & Vibe",
        category: "Interaction",
        image: "/images/landing/updated-landing/share.png"
    },
    {
        id: 3,
        title: "Record Vibes",
        category: "History",
        image: "/images/landing/updated-landing/record.png"
    },
    {
        id: 4,
        title: "AI Insights",
        category: "Analysis",
        image: "/images/landing/updated-landing/Analysis.png"
    }
]

export function LandingShowcase() {
    return (
        <section id="works" className="py-12 sm:py-16 lg:py-20 px-4 sm:px-6 bg-beige-bg dark:bg-background">
            <div className="container mx-auto">
                <div className="flex flex-col md:flex-row justify-between items-start mb-8 sm:mb-12 lg:mb-16 gap-4 md:gap-8">
                    <FadeIn delay={0.1}>
                        <h2 className="text-xs sm:text-sm font-mono text-gray-secondary">[01] HOW IT WORKS</h2>
                    </FadeIn>
                    <FadeIn delay={0.2} className="max-w-2xl">
                        <p className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-switzer leading-tight dark:text-foreground">
                            Create agents, vibe with people, and get real insights through AI analysis.
                        </p>
                    </FadeIn>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8 lg:gap-12">
                    {projects.map((project, index) => (
                        <FadeIn key={project.id} delay={0.2 + (index * 0.1)}>
                            <div className="group cursor-pointer">
                                <div className="relative aspect-[4/3] overflow-hidden rounded-lg mb-3 sm:mb-4 bg-gray-100 dark:bg-muted">
                                    <Image
                                        src={project.image}
                                        alt={project.title}
                                        fill
                                        className="object-cover transition-transform duration-700 ease-custom group-hover:scale-105"
                                        sizes="(max-width: 640px) 100vw, 50vw"
                                    />
                                    <div className="absolute inset-0 bg-black-primary/0 group-hover:bg-black-primary/10 transition-colors duration-500 dark:group-hover:bg-white/10"></div>
                                </div>
                                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-1 sm:gap-0">
                                    <h3 className="text-lg sm:text-xl font-medium dark:text-foreground">{project.title}</h3>
                                    <span className="text-xs sm:text-sm text-gray-secondary">{project.category}</span>
                                </div>
                            </div>
                        </FadeIn>
                    ))}
                </div>
            </div>
        </section>
    )
}
