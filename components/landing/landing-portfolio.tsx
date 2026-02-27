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
        <section className="overflow-hidden bg-purewhite-bg py-20 md:py-32">
            <div className="container mx-auto max-w-7xl px-6 lg:px-12">
                {/* Section header */}
                <div className="mb-12 flex items-end justify-between">
                    <div>
                        <h2 className="mb-4 font-switzer text-h2 font-bold text-black-primary">
                            Example Agents
                        </h2>
                        <p className="font-switzer text-lg text-gray-secondary">
                            See what you can build with VibesBoard
                        </p>
                    </div>

                    {/* Navigation buttons - desktop */}
                    <div className="hidden gap-3 md:flex">
                        <button
                            onClick={() => scroll('left')}
                            className="rounded-full border-2 border-black-primary p-3 text-black-primary transition-all duration-300 hover:bg-black-primary hover:text-purewhite-bg"
                            aria-label="Scroll left"
                        >
                            <svg className="size-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                        </button>
                        <button
                            onClick={() => scroll('right')}
                            className="rounded-full border-2 border-black-primary p-3 text-black-primary transition-all duration-300 hover:bg-black-primary hover:text-purewhite-bg"
                            aria-label="Scroll right"
                        >
                            <svg className="size-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* Scrollable portfolio */}
                <div
                    ref={scrollRef}
                    className="scrollbar-hide flex snap-x snap-mandatory gap-6 overflow-x-auto pb-4"
                    style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                >
                    {agents.map((agent, index) => (
                        <div
                            key={index}
                            className="w-80 flex-none snap-start md:w-96"
                        >
                            <div className="h-full rounded-3xl border border-black-10 bg-beige-bg p-8 transition-all duration-300 hover:border-black-25 hover:shadow-lg">
                                {/* Placeholder image area */}
                                <div className="mb-6 flex h-48 w-full items-center justify-center rounded-2xl bg-gradient-to-br from-black-10 to-black-25">
                                    <svg className="size-16 text-gray-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                                    </svg>
                                </div>

                                <div className="mb-2 font-switzer text-sm font-medium text-gray-secondary">
                                    {agent.category}
                                </div>
                                <h3 className="mb-3 font-switzer text-2xl font-semibold text-black-primary">
                                    {agent.title}
                                </h3>
                                <p className="font-switzer text-base leading-relaxed text-gray-secondary">
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
