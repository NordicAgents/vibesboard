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
        <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 bg-beige-bg/80 backdrop-blur-sm dark:bg-background/80 safe-area-inset-top">
            <div className="flex items-center">
                <Link href="/" className="text-xl sm:text-2xl font-bold font-switzer tracking-tighter dark:text-foreground">
                    vibesboard
                </Link>
            </div>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center space-x-6 lg:space-x-8">
                <DropdownMenu>
                    <DropdownMenuTrigger className="text-sm font-medium hover:text-gray-secondary transition-colors outline-none flex items-center gap-1 group dark:text-foreground dark:hover:text-muted-foreground">
                        Products
                        <ChevronDown className="w-3.5 h-3.5 transition-transform group-data-[state=open]:rotate-180" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="min-w-[280px] lg:min-w-[320px] p-2 bg-white/95 backdrop-blur-lg border-gray-200 shadow-2xl dark:bg-popover/95 dark:border-border">
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
                {navLinks.map((link) => (
                    <Link 
                        key={link.href}
                        href={link.href} 
                        className="text-sm font-medium hover:text-gray-secondary transition-colors dark:text-foreground dark:hover:text-muted-foreground"
                    >
                        {link.label}
                    </Link>
                ))}
            </nav>

            {/* Desktop Login Button */}
            <div className="hidden md:flex items-center">
                <Button variant="outline" className="rounded-full px-4 lg:px-6 border-black-primary text-black-primary hover:bg-black-primary hover:text-white transition-colors dark:border-white dark:text-white dark:hover:bg-white dark:hover:text-black" asChild>
                    <Link href="/sign-in">Login</Link>
                </Button>
            </div>

            {/* Mobile Menu Button */}
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                <SheetTrigger asChild className="md:hidden">
                    <Button variant="ghost" size="icon" className="h-10 w-10">
                        <Menu className="h-5 w-5" />
                        <span className="sr-only">Open menu</span>
                    </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-full sm:w-[350px] p-0">
                    <SheetHeader className="p-4 border-b">
                        <SheetTitle className="text-left font-switzer text-xl">Menu</SheetTitle>
                    </SheetHeader>
                    <nav className="flex flex-col p-4 space-y-1">
                        {/* Products Section */}
                        <div className="space-y-2">
                            <p className="text-xs font-medium text-gray-secondary uppercase tracking-wider px-2">Products</p>
                            {products.map((product) => (
                                <Link
                                    key={product.name}
                                    href={product.href}
                                    target={product.isExternal ? '_blank' : undefined}
                                    rel={product.isExternal ? 'noopener noreferrer' : undefined}
                                    onClick={() => setMobileMenuOpen(false)}
                                    className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted transition-colors"
                                >
                                    <div className={`w-1 h-full min-h-[40px] rounded-full ${product.accentColor}`} />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium text-sm">{product.name}</span>
                                            {product.isExternal && (
                                                <ExternalLink className="w-3 h-3 text-gray-400" />
                                            )}
                                        </div>
                                        <p className="text-xs text-gray-secondary">{product.description}</p>
                                    </div>
                                </Link>
                            ))}
                        </div>

                        <div className="border-t my-2" />

                        {/* Navigation Links */}
                        <div className="space-y-1">
                            {navLinks.map((link) => (
                                <Link
                                    key={link.href}
                                    href={link.href}
                                    onClick={() => setMobileMenuOpen(false)}
                                    className="flex items-center p-3 rounded-lg hover:bg-muted transition-colors text-sm font-medium"
                                >
                                    {link.label}
                                </Link>
                            ))}
                        </div>

                        <div className="border-t my-2" />

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
