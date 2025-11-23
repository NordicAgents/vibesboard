export function LandingFeatures() {
    const features = [
        {
            title: "Build Agents",
            description: "Create custom AI agents tailored to your needs. Design conversation flows, set personalities, and configure behaviors that match your goals.",
        },
        {
            title: "Record Vibes",
            description: "Capture authentic interactions as your agents engage with people. Every conversation, response, and nuance is recorded for deep analysis.",
        },
        {
            title: "AI Insights",
            description: "Unlock the real vibe with advanced AI analysis. Understand sentiment, detect patterns, and gain insights that matter from every interaction.",
        }
    ]

    return (
        <section id="features" className="bg-beige-bg py-20 md:py-32">
            <div className="container mx-auto px-6 lg:px-12 max-w-7xl">
                {/* Section header */}
                <div className="text-center max-w-4xl mx-auto mb-16 md:mb-20">
                    <h2 className="font-switzer font-bold text-h2 text-black-primary mb-6">
                        Everything you need to understand the vibe
                    </h2>
                    <p className="font-switzer text-lg md:text-xl text-gray-secondary">
                        Build, deploy, and analyze AI agents that capture authentic human interactions
                    </p>
                </div>

                {/* Features grid - NORRE style */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
                    {features.map((feature, index) => (
                        <div
                            key={index}
                            className="group p-8 lg:p-10 rounded-3xl bg-purewhite-bg border border-black-10 hover:border-black-25 transition-all duration-300 hover:shadow-lg"
                        >
                            <h3 className="font-switzer font-semibold text-2xl lg:text-3xl text-black-primary mb-4">
                                {feature.title}
                            </h3>
                            <p className="font-switzer text-base lg:text-lg text-gray-secondary leading-relaxed">
                                {feature.description}
                            </p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    )
}
