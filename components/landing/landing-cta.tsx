import Link from 'next/link'

export function LandingCTA() {
    return (
        <section className="bg-black-primary py-24 md:py-32 lg:py-40">
            <div className="container mx-auto max-w-5xl px-6 lg:px-12">
                <div className="text-center">
                    <h2 className="mb-6 font-switzer text-4xl font-bold leading-tight text-purewhite-bg md:text-5xl lg:text-6xl">
                        Ready to feel the vibe?
                    </h2>
                    <p className="text-purewhite-bg/80 mx-auto mb-12 max-w-2xl font-switzer text-lg leading-relaxed md:text-xl">
                        Join thousands of users who are building AI agents to understand what people really think and feel.
                    </p>

                    <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
                        <Link
                            href="/sign-up"
                            className="rounded-full bg-purewhite-bg px-10 py-5 font-switzer text-lg font-medium text-black-primary shadow-sm transition-all duration-300 hover:bg-beige-bg hover:shadow-md"
                        >
                            Get Started Free
                        </Link>
                        <Link
                            href="#features"
                            className="rounded-full border-2 border-purewhite-bg bg-transparent px-10 py-5 font-switzer text-lg font-medium text-purewhite-bg transition-all duration-300 hover:bg-purewhite-bg hover:text-black-primary"
                        >
                            See How It Works
                        </Link>
                    </div>
                </div>
            </div>
        </section>
    )
}
