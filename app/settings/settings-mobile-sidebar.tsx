'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Menu, Settings, Building2, Users } from 'lucide-react'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
 Building2,
 Users
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
 className="size-9 text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
 >
 <Menu className="size-5" />
 <span className="sr-only">Open menu</span>
 </Button>
 </SheetTrigger>
 <SheetContent
 side="left"
 className="w-[260px] border-r border-border-warm bg-bg-surface p-0"
 >
 <div className="flex h-16 items-center gap-2.5 border-b border-border-warm px-5">
 <div className="flex size-7 items-center justify-center rounded-lg bg-bg-hover">
 <Settings className="size-3.5 text-accent-orange" />
 </div>
 <h2 className="font-sans text-base font-normal text-text-primary">
 Settings
 </h2>
 </div>
 <nav className="flex-1 space-y-0.5 p-3">
 <p className="label-caps mb-2 px-3">Navigation</p>
 {navItems.map(item => {
 const Icon = iconMap[item.icon]
 return (
 <Link
 key={item.href}
 href={item.href}
 onClick={() => setOpen(false)}
 className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-text-secondary transition-all duration-150 hover:bg-bg-hover hover:text-text-primary"
 >
 {Icon && <Icon className="size-4 shrink-0 text-text-tertiary" />}
 {item.title}
 </Link>
 )
 })}
 </nav>
 </SheetContent>
 </Sheet>
 )
}
