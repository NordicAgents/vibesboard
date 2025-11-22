import Link from 'next/link'

export function LandingCTA() {
    return (
        <section className="bg-black-primary py-24 md:py-32 lg:py-40">
            <div className="container mx-auto px-6 lg:px-12 max-w-5xl">
                <div className="text-center">
                    <h2 className="font-switzer font-bold text-4xl md:text-5xl lg:text-6xl text-purewhite-bg mb-6 leading-tight">
                        Ready to feel the vibe?
                    </h2>
                    <p className="font-switzer text-lg md:text-xl text-purewhite-bg/80 mb-12 max-w-2xl mx-auto leading-relaxed">
                        Join thousands of users who are building AI agents to understand what people really think and feel.
                    </p>

                    <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
                        <Link
                            href="/sign-up"
                            className="px-10 py-5 bg-purewhite-bg text-black-primary font-switzer text-lg font-medium rounded-full hover:bg-beige-bg transition-all duration-300 shadow-sm hover:shadow-md"
                        >
                            Get Started Free
                        </Link>
                        <Link
                            href="#features"
                            className="px-10 py-5 bg-transparent border-2 border-purewhite-bg text-purewhite-bg font-switzer text-lg font-medium rounded-full hover:bg-purewhite-bg hover:text-black-primary transition-all duration-300"
                        >
                            See How It Works
                        </Link>
                    </div>
                </div>
            </div>
        </section>
    )
}
