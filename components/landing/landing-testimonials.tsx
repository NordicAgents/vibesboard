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
            <div className="container mx-auto px-6 lg:px-12 max-w-5xl">
                {/* Testimonial content */}
                <div className="text-center mb-12">
                    <blockquote className="font-switzer text-2xl md:text-3xl lg:text-4xl text-black-primary font-medium mb-8 leading-relaxed">
                        "{testimonials[currentIndex].quote}"
                    </blockquote>
                    <div className="font-switzer">
                        <div className="text-lg font-semibold text-black-primary">
                            {testimonials[currentIndex].author}
                        </div>
                        <div className="text-base text-gray-secondary mt-1">
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
                            className={`transition-all duration-300 rounded-full ${index === currentIndex
                                    ? 'w-12 h-3 bg-black-primary'
                                    : 'w-3 h-3 bg-gray-secondary hover:bg-black-25'
                                }`}
                            aria-label={`Go to testimonial ${index + 1}`}
                        />
                    ))}
                </div>
            </div>
        </section>
    )
}
