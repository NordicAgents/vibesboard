'use client'

export function LandingStatistics() {
    const statistics = [
        {
            label: "Active Agents",
            value: "10,000+",
        },
        {
            label: "Conversations",
            value: "1M+",
        },
        {
            label: "Insights Generated",
            value: "500K+",
        },
        {
            label: "User Satisfaction",
            value: "98%",
        }
    ]

    return (
        <section className="bg-purewhite-bg py-16 md:py-24 border-y border-black-10">
            <div className="container mx-auto px-6 lg:px-12 max-w-7xl">
                {/* Grid layout for all screen sizes - NORRE style */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
                    {statistics.map((stat, index) => (
                        <div
                            key={index}
                            className="text-center"
                        >
                            <div className="font-switzer font-bold text-5xl md:text-6xl lg:text-7xl text-black-primary mb-2">
                                {stat.value}
                            </div>
                            <div className="font-switzer text-base md:text-lg text-gray-secondary">
                                {stat.label}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    )
}
