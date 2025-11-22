import Link from 'next/link'
import { Button } from '@/components/ui/button'

export function LandingHeader() {
    return (
        <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 bg-beige-bg/80 backdrop-blur-sm">
            <div className="flex items-center">
                <Link href="/" className="text-2xl font-bold font-switzer tracking-tighter">
                    vibesboard
                </Link>
            </div>

            <nav className="hidden md:flex items-center space-x-8">
                <Link href="#works" className="text-sm font-medium hover:text-gray-secondary transition-colors">
                    How It Works
                </Link>
                <Link href="#services" className="text-sm font-medium hover:text-gray-secondary transition-colors">
                    Features
                </Link>
                <Link href="#about" className="text-sm font-medium hover:text-gray-secondary transition-colors">
                    About
                </Link>
            </nav>

            <div className="flex items-center">
                <Button variant="outline" className="rounded-full px-6 border-black-primary text-black-primary hover:bg-black-primary hover:text-white transition-colors">
                    Let's Talk
                </Button>
            </div>
        </header>
    )
}
