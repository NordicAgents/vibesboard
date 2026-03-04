'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Menu, ShieldCheck, Building2, Flag, FileText } from 'lucide-react'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import type { LucideIcon } from 'lucide-react'

const iconMap: Record<string, LucideIcon> = {
    Building2,
    Flag,
    FileText,
}

export interface NavItem {
    href: string
    iconName: string
    label: string
}

export function AdminMobileSidebar({ navItems }: { navItems: NavItem[] }) {
    const [open, setOpen] = useState(false)

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-9 text-[#9D9790] hover:bg-[#EDE8DE] hover:text-[#1A1915] dark:text-[#6B6560] dark:hover:bg-[#2E2B25] dark:hover:text-[#E8E3D8]"
                >
                    <Menu className="size-5" />
                    <span className="sr-only">Open menu</span>
                </Button>
            </SheetTrigger>
            <SheetContent
                side="left"
                className="w-[260px] border-r border-[#E2DDD4] bg-[#FDFAF5] p-0 dark:border-[#2E2B25] dark:bg-[#221F1A]"
            >
                <div className="flex h-16 items-center gap-2.5 border-b border-[#E2DDD4] px-5 dark:border-[#2E2B25]">
                    <div className="flex size-7 items-center justify-center rounded-lg bg-[#EDE8DE] dark:bg-[#2E2B25]">
                        <ShieldCheck className="size-3.5 text-accent-orange" />
                    </div>
                    <div>
                        <h2 className="font-serif text-base font-normal text-[#1A1915] dark:text-[#E8E3D8]">
                            Admin
                        </h2>
                        <p className="text-[11px] text-[#9D9790]">System Management</p>
                    </div>
                </div>
                <nav className="flex-1 space-y-0.5 p-3">
                    <p className="label-caps mb-2 px-3">Management</p>
                    {navItems.map((item) => {
                        const Icon = iconMap[item.iconName]
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setOpen(false)}
                                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[#6B6560] transition-all duration-150 hover:bg-[#EDE8DE] hover:text-[#1A1915] dark:text-[#9D9790] dark:hover:bg-[#2E2B25] dark:hover:text-[#E8E3D8]"
                            >
                                {Icon && <Icon className="size-4 shrink-0 text-[#9D9790]" />}
                                {item.label}
                            </Link>
                        )
                    })}
                </nav>
            </SheetContent>
        </Sheet>
    )
}
