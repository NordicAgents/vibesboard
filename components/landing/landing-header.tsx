'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from '@/components/ui/sheet'
import { ChevronDown, ExternalLink, Menu, X } from 'lucide-react'

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

const navLinks = [
    { href: '#services', label: 'Features' },
    { href: '#about', label: 'About' },
]

export function LandingHeader() {
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

    return (
        <header className="bg-beige-bg/80 safe-area-inset-top fixed inset-x-0 top-0 z-50 flex items-center justify-between px-4 py-3 backdrop-blur-sm dark:bg-background/80 sm:px-6 sm:py-4">
            <div className="flex items-center">
                <Link href="/" className="font-switzer text-xl font-bold tracking-tighter dark:text-foreground sm:text-2xl">
                    vibesboard
                </Link>
            </div>

            {/* Desktop Navigation */}
            <nav className="hidden items-center space-x-6 md:flex lg:space-x-8">
                <DropdownMenu>
                    <DropdownMenuTrigger className="group flex items-center gap-1 text-sm font-medium outline-none transition-colors hover:text-gray-secondary dark:text-foreground dark:hover:text-muted-foreground">
                        Products
                        <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="min-w-[280px] border-gray-200 bg-white/95 p-2 shadow-2xl backdrop-blur-lg dark:border-border dark:bg-popover/95 lg:min-w-[320px]">
                        <div className="space-y-1">
                            {products.map((product) => {
                                return (
                                    <DropdownMenuItem key={product.name} asChild className="p-0 focus:bg-transparent">
                                        <Link
                                            href={product.href}
                                            target={product.isExternal ? '_blank' : undefined}
                                            rel={product.isExternal ? 'noopener noreferrer' : undefined}
                                            className="hover:bg-beige-bg/50 group/item relative flex cursor-pointer items-start gap-3 overflow-hidden rounded-lg p-3 transition-all dark:hover:bg-accent"
                                        >
                                            <div className={`absolute inset-y-0 left-0 w-1 ${product.accentColor} origin-top scale-y-0 transition-transform group-hover/item:scale-y-100`} />
                                            <div className="min-w-0 flex-1 pl-2">
                                                <div className="flex items-center justify-between gap-2">
                                                    <h3 className="text-sm font-semibold text-black-primary transition-transform group-hover/item:translate-x-1 dark:text-foreground">
                                                        {product.name}
                                                    </h3>
                                                    {product.isExternal && (
                                                        <ExternalLink className="size-3.5 text-gray-400 opacity-0 transition-opacity group-hover/item:opacity-100" />
                                                    )}
                                                </div>
                                                <p className="mt-0.5 text-xs text-gray-secondary dark:text-muted-foreground">
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
                {navLinks.map((link) => (
                    <Link 
                        key={link.href}
                        href={link.href} 
                        className="text-sm font-medium transition-colors hover:text-gray-secondary dark:text-foreground dark:hover:text-muted-foreground"
                    >
                        {link.label}
                    </Link>
                ))}
            </nav>

            {/* Desktop Login Button */}
            <div className="hidden items-center md:flex">
                <Button variant="outline" className="rounded-full border-black-primary px-4 text-black-primary transition-colors hover:bg-black-primary hover:text-white dark:border-white dark:text-white dark:hover:bg-white dark:hover:text-black lg:px-6" asChild>
                    <Link href="/sign-in">Login</Link>
                </Button>
            </div>

            {/* Mobile Menu Button */}
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                <SheetTrigger asChild className="md:hidden">
                    <Button variant="ghost" size="icon" className="size-10">
                        <Menu className="size-5" />
                        <span className="sr-only">Open menu</span>
                    </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-full p-0 sm:w-[350px]">
                    <SheetHeader className="border-b p-4">
                        <SheetTitle className="text-left font-switzer text-xl">Menu</SheetTitle>
                    </SheetHeader>
                    <nav className="flex flex-col space-y-1 p-4">
                        {/* Products Section */}
                        <div className="space-y-2">
                            <p className="px-2 text-xs font-medium uppercase tracking-wider text-gray-secondary">Products</p>
                            {products.map((product) => (
                                <Link
                                    key={product.name}
                                    href={product.href}
                                    target={product.isExternal ? '_blank' : undefined}
                                    rel={product.isExternal ? 'noopener noreferrer' : undefined}
                                    onClick={() => setMobileMenuOpen(false)}
                                    className="flex items-start gap-3 rounded-lg p-3 transition-colors hover:bg-muted"
                                >
                                    <div className={`h-full min-h-[40px] w-1 rounded-full ${product.accentColor}`} />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium">{product.name}</span>
                                            {product.isExternal && (
                                                <ExternalLink className="size-3 text-gray-400" />
                                            )}
                                        </div>
                                        <p className="text-xs text-gray-secondary">{product.description}</p>
                                    </div>
                                </Link>
                            ))}
                        </div>

                        <div className="my-2 border-t" />

                        {/* Navigation Links */}
                        <div className="space-y-1">
                            {navLinks.map((link) => (
                                <Link
                                    key={link.href}
                                    href={link.href}
                                    onClick={() => setMobileMenuOpen(false)}
                                    className="flex items-center rounded-lg p-3 text-sm font-medium transition-colors hover:bg-muted"
                                >
                                    {link.label}
                                </Link>
                            ))}
                        </div>

                        <div className="my-2 border-t" />

                        {/* Login Button */}
                        <Button 
                            variant="outline" 
                            className="w-full rounded-full border-black-primary text-black-primary hover:bg-black-primary hover:text-white dark:border-white dark:text-white dark:hover:bg-white dark:hover:text-black" 
                            asChild
                        >
                            <Link href="/sign-in" onClick={() => setMobileMenuOpen(false)}>Login</Link>
                        </Button>
                    </nav>
                </SheetContent>
            </Sheet>
        </header>
    )
}
