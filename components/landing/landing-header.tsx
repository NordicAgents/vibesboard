'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ChevronDown, ExternalLink } from 'lucide-react'

const products = [
    {
        name: 'Conversation vibesboard',
        description: 'AI-powered conversations',
        accentColor: 'bg-blue-500',
        href: '/sign-in',
        isExternal: false,
    },
    {
        name: 'Feedback vibesboard',
        description: 'Capture user insights',
        accentColor: 'bg-purple-500',
        href: 'https://social.vibesboard.com/',
        isExternal: true,
    },
    {
        name: 'Enterprise vibesboard',
        description: 'Scalable solutions',
        accentColor: 'bg-emerald-500',
        href: 'https://org.vibesboard.com/',
        isExternal: true,
    },
]

export function LandingHeader() {
    return (
        <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 bg-beige-bg/80 backdrop-blur-sm dark:bg-background/80">
            <div className="flex items-center">
                <Link href="/" className="text-2xl font-bold font-switzer tracking-tighter dark:text-foreground">
                    vibesboard
                </Link>
            </div>

            <nav className="hidden md:flex items-center space-x-8">
                <DropdownMenu>
                    <DropdownMenuTrigger className="text-sm font-medium hover:text-gray-secondary transition-colors outline-none flex items-center gap-1 group dark:text-foreground dark:hover:text-muted-foreground">
                        Products
                        <ChevronDown className="w-3.5 h-3.5 transition-transform group-data-[state=open]:rotate-180" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="min-w-[320px] p-2 bg-white/95 backdrop-blur-lg border-gray-200 shadow-2xl dark:bg-popover/95 dark:border-border">
                        <div className="space-y-1">
                            {products.map((product) => {
                                return (
                                    <DropdownMenuItem key={product.name} asChild className="p-0 focus:bg-transparent">
                                        <Link
                                            href={product.href}
                                            target={product.isExternal ? '_blank' : undefined}
                                            rel={product.isExternal ? 'noopener noreferrer' : undefined}
                                            className="flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-all hover:bg-beige-bg/50 group/item relative overflow-hidden dark:hover:bg-accent"
                                        >
                                            <div className={`absolute left-0 top-0 bottom-0 w-1 ${product.accentColor} transform scale-y-0 group-hover/item:scale-y-100 transition-transform origin-top`} />
                                            <div className="flex-1 min-w-0 pl-2">
                                                <div className="flex items-center justify-between gap-2">
                                                    <h3 className="font-semibold text-sm text-black-primary group-hover/item:translate-x-1 transition-transform dark:text-foreground">
                                                        {product.name}
                                                    </h3>
                                                    {product.isExternal && (
                                                        <ExternalLink className="w-3.5 h-3.5 text-gray-400 opacity-0 group-hover/item:opacity-100 transition-opacity" />
                                                    )}
                                                </div>
                                                <p className="text-xs text-gray-secondary mt-0.5 dark:text-muted-foreground">
                                                    {product.description}
                                                </p>
                                            </div>
                                        </Link>
                                    </DropdownMenuItem>
                                )
                            })}
                        </div>
                    </DropdownMenuContent>
                </DropdownMenu>
                <Link href="#services" className="text-sm font-medium hover:text-gray-secondary transition-colors dark:text-foreground dark:hover:text-muted-foreground">
                    Features
                </Link>
                <Link href="#about" className="text-sm font-medium hover:text-gray-secondary transition-colors dark:text-foreground dark:hover:text-muted-foreground">
                    About
                </Link>
            </nav>

            <div className="flex items-center">
                <Button variant="outline" className="rounded-full px-6 border-black-primary text-black-primary hover:bg-black-primary hover:text-white transition-colors dark:border-white dark:text-white dark:hover:bg-white dark:hover:text-black" asChild>
                    <Link href="/sign-in">Login</Link>
                </Button>
            </div>
        </header>
    )
}
