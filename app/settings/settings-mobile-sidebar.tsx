'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Menu, Settings, Building2, Users } from 'lucide-react'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
    Building2,
    Users,
}

interface NavItem {
    href: string
    icon: string
    title: string
}

export function SettingsMobileSidebar({ navItems }: { navItems: NavItem[] }) {
    const [open, setOpen] = useState(false)

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-9 text-[#8A8A8A] hover:bg-[#EFEFED] hover:text-[#1A1A1A] dark:text-[#5A5A5A] dark:hover:bg-[#2A2A2A] dark:hover:text-[#F0F0F0]"
                >
                    <Menu className="size-5" />
                    <span className="sr-only">Open menu</span>
                </Button>
            </SheetTrigger>
            <SheetContent
                side="left"
                className="w-[260px] border-r border-[#E5E5E5] bg-[#F7F7F5] p-0 dark:border-[#2A2A2A] dark:bg-[#141414]"
            >
                <div className="flex h-16 items-center gap-2.5 border-b border-[#E5E5E5] px-5 dark:border-[#2A2A2A]">
                    <div className="flex size-7 items-center justify-center rounded-lg bg-[#EFEFED] dark:bg-[#2A2A2A]">
                        <Settings className="size-3.5 text-accent-orange" />
                    </div>
                    <h2 className="font-sans text-base font-normal text-[#1A1A1A] dark:text-[#F0F0F0]">
                        Settings
                    </h2>
                </div>
                <nav className="flex-1 space-y-0.5 p-3">
                    <p className="label-caps mb-2 px-3">Navigation</p>
                    {navItems.map((item) => {
                        const Icon = iconMap[item.icon]
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setOpen(false)}
                                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[#5A5A5A] transition-all duration-150 hover:bg-[#EFEFED] hover:text-[#1A1A1A] dark:text-[#8A8A8A] dark:hover:bg-[#2A2A2A] dark:hover:text-[#F0F0F0]"
                            >
                                {Icon && <Icon className="size-4 shrink-0 text-[#8A8A8A]" />}
                                {item.title}
                            </Link>
                        )
                    })}
                </nav>
            </SheetContent>
        </Sheet>
    )
}
