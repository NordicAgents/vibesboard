'use client'

import { useState, useEffect } from 'react'

export function LandingTestimonials() {
    const testimonials = [
        {
            quote: "VibesBoard transformed how we understand our customers. The AI insights revealed patterns we never knew existed.",
            author: "Sarah Chen",
            role: "Product Manager, TechCorp"
        },
        {
            quote: "The ability to capture authentic conversations and analyze them at scale has been a game-changer for our research team.",
            author: "Michael Rodriguez",
            role: "UX Researcher, DesignLab"
        },
        {
            quote: "We've built agents that feel natural and engaging. The vibe analysis helps us understand what really resonates with people.",
            author: "Emily Watson",
            role: "Marketing Director, BrandCo"
        }
    ]

    const [currentIndex, setCurrentIndex] = useState(0)

    useEffect(() => {
        const interval = setInterval(() => {
            setCurrentIndex((prev) => (prev + 1) % testimonials.length)
        }, 5000)
        return () => clearInterval(interval)
    }, [testimonials.length])

    const goToSlide = (index: number) => {
        setCurrentIndex(index)
    }

    return (
        <section className="bg-beige-bg py-20 md:py-32">
            <div className="container mx-auto max-w-5xl px-6 lg:px-12">
                {/* Testimonial content */}
                <div className="mb-12 text-center">
                    <blockquote className="mb-8 font-switzer text-2xl font-medium leading-relaxed text-black-primary md:text-3xl lg:text-4xl">
                        &ldquo;{testimonials[currentIndex].quote}&rdquo;
                    </blockquote>
                    <div className="font-switzer">
                        <div className="text-lg font-semibold text-black-primary">
                            {testimonials[currentIndex].author}
                        </div>
                        <div className="mt-1 text-base text-gray-secondary">
                            {testimonials[currentIndex].role}
                        </div>
                    </div>
                </div>

                {/* Dots navigation */}
                <div className="flex justify-center gap-3">
                    {testimonials.map((_, index) => (
                        <button
                            key={index}
                            onClick={() => goToSlide(index)}
                            className={`rounded-full transition-all duration-300 ${index === currentIndex
                                ? 'h-3 w-12 bg-black-primary'
                                : 'size-3 bg-gray-secondary hover:bg-black-25'
                                }`}
                            aria-label={`Go to testimonial ${index + 1}`}
                        />
                    ))}
                </div>
            </div>
        </section>
    )
}
