'use client'

import { useRef } from 'react'

export function LandingPortfolio() {
    const scrollRef = useRef<HTMLDivElement>(null)

    const agents = [
        {
            title: "Customer Feedback Agent",
            category: "Research",
            description: "Gather authentic customer insights through natural conversations"
        },
        {
            title: "Product Testing Agent",
            category: "UX Research",
            description: "Test product concepts and collect real-time user reactions"
        },
        {
            title: "Market Research Agent",
            category: "Analytics",
            description: "Understand market sentiment and consumer preferences"
        },
        {
            title: "Brand Perception Agent",
            category: "Marketing",
            description: "Measure how people really feel about your brand"
        },
        {
            title: "Employee Engagement Agent",
            category: "HR",
            description: "Capture authentic employee feedback and workplace vibes"
        }
    ]

    const scroll = (direction: 'left' | 'right') => {
        if (scrollRef.current) {
            const scrollAmount = 400
            scrollRef.current.scrollBy({
                left: direction === 'left' ? -scrollAmount : scrollAmount,
                behavior: 'smooth'
            })
        }
    }

    return (
        <section className="bg-purewhite-bg py-20 md:py-32 overflow-hidden">
            <div className="container mx-auto px-6 lg:px-12 max-w-7xl">
                {/* Section header */}
                <div className="flex justify-between items-end mb-12">
                    <div>
                        <h2 className="font-switzer font-bold text-h2 text-black-primary mb-4">
                            Example Agents
                        </h2>
                        <p className="font-switzer text-lg text-gray-secondary">
                            See what you can build with VibesBoard
                        </p>
                    </div>

                    {/* Navigation buttons - desktop */}
                    <div className="hidden md:flex gap-3">
                        <button
                            onClick={() => scroll('left')}
                            className="p-3 rounded-full border-2 border-black-primary text-black-primary hover:bg-black-primary hover:text-purewhite-bg transition-all duration-300"
                            aria-label="Scroll left"
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                        </button>
                        <button
                            onClick={() => scroll('right')}
                            className="p-3 rounded-full border-2 border-black-primary text-black-primary hover:bg-black-primary hover:text-purewhite-bg transition-all duration-300"
                            aria-label="Scroll right"
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* Scrollable portfolio */}
                <div
                    ref={scrollRef}
                    className="flex gap-6 overflow-x-auto pb-4 scrollbar-hide snap-x snap-mandatory"
                    style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                >
                    {agents.map((agent, index) => (
                        <div
                            key={index}
                            className="flex-none w-80 md:w-96 snap-start"
                        >
                            <div className="h-full p-8 rounded-3xl bg-beige-bg border border-black-10 hover:border-black-25 transition-all duration-300 hover:shadow-lg">
                                {/* Placeholder image area */}
                                <div className="w-full h-48 mb-6 rounded-2xl bg-gradient-to-br from-black-10 to-black-25 flex items-center justify-center">
                                    <svg className="w-16 h-16 text-gray-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                                    </svg>
                                </div>

                                <div className="text-sm font-switzer font-medium text-gray-secondary mb-2">
                                    {agent.category}
                                </div>
                                <h3 className="font-switzer font-semibold text-2xl text-black-primary mb-3">
                                    {agent.title}
                                </h3>
                                <p className="font-switzer text-base text-gray-secondary leading-relaxed">
                                    {agent.description}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    )
}
