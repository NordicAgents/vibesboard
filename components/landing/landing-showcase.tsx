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
        <section id="works" className="py-20 px-6 bg-beige-bg dark:bg-background">
            <div className="container mx-auto">
                <div className="flex flex-col md:flex-row justify-between items-start mb-16">
                    <FadeIn delay={0.1}>
                        <h2 className="text-sm font-mono text-gray-secondary mb-4 md:mb-0">[01] HOW IT WORKS</h2>
                    </FadeIn>
                    <FadeIn delay={0.2} className="max-w-2xl">
                        <p className="text-2xl md:text-4xl font-switzer leading-tight dark:text-foreground">
                            Create agents, vibe with people, and get real insights through AI analysis.
                        </p>
                    </FadeIn>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12">
                    {projects.map((project, index) => (
                        <FadeIn key={project.id} delay={0.2 + (index * 0.1)}>
                            <div className="group cursor-pointer">
                                <div className="relative aspect-[4/3] overflow-hidden rounded-lg mb-4 bg-gray-100 dark:bg-muted">
                                    <img
                                        src={project.image}
                                        alt={project.title}
                                        className="w-full h-full object-cover transition-transform duration-700 ease-custom group-hover:scale-105"
                                    />
                                    <div className="absolute inset-0 bg-black-primary/0 group-hover:bg-black-primary/10 transition-colors duration-500 dark:group-hover:bg-white/10"></div>
                                </div>
                                <div className="flex justify-between items-center">
                                    <h3 className="text-xl font-medium dark:text-foreground">{project.title}</h3>
                                    <span className="text-sm text-gray-secondary">{project.category}</span>
                                </div>
                            </div>
                        </FadeIn>
                    ))}
                </div>
            </div>
        </section>
    )
}
