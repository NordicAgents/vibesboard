'use client'

import { signOut } from 'firebase/auth'
import { getClientAuth } from '@/lib/firebase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Settings } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
 DropdownMenu,
 DropdownMenuContent,
 DropdownMenuItem,
 DropdownMenuSeparator,
 DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

export interface UserMenuProps {
 user: {
 id: string
 email?: string
 name?: string
 image?: string
 }
 isSuperAdmin?: boolean
 canManageTenant?: boolean
}

export function UserMenu({
 user,
 isSuperAdmin,
 canManageTenant
}: UserMenuProps) {
 const router = useRouter()

 const handleSignOut = async () => {
 // Sign out from Firebase client
 const auth = getClientAuth()
 await signOut(auth)

 // Clear the server-side session cookie
 await fetch('/api/auth/session', { method: 'DELETE' })

 router.refresh()
 }

 return (
 <div className="flex items-center justify-between">
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button
 variant="ghost"
 size="icon"
 className="size-9 text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
 >
 <Settings className="size-5" />
 <span className="sr-only">User Settings</span>
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent
 sideOffset={8}
 align="end"
 className="w-[200px] rounded-xl border border-border-warm bg-bg-surface p-1 shadow-md"
 >
 <DropdownMenuItem className="flex-col items-start rounded-lg px-3 py-2 focus:bg-bg-hover">
 <div className="text-xs font-medium text-text-primary">
 {user?.name}
 </div>
 <div className="w-full truncate text-xs text-text-tertiary">
 {user?.email}
 </div>
 </DropdownMenuItem>
 <DropdownMenuSeparator className="my-1 bg-[#e4e3e3]" />
 {canManageTenant && (
 <DropdownMenuItem asChild>
 <Link
 href="/settings/tenant"
 className="cursor-pointer rounded-lg px-3 py-2 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary focus:bg-bg-hover focus:text-text-primary"
 >
 Tenant Settings
 </Link>
 </DropdownMenuItem>
 )}
 {isSuperAdmin && (
 <DropdownMenuItem asChild>
 <Link
 href="/admin"
 className="cursor-pointer rounded-lg px-3 py-2 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary focus:bg-bg-hover focus:text-text-primary"
 >
 Super Admin
 </Link>
 </DropdownMenuItem>
 )}
 <DropdownMenuItem
 onClick={handleSignOut}
 className="cursor-pointer rounded-lg px-3 py-2 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary focus:bg-bg-hover focus:text-text-primary"
 >
 Log Out
 </DropdownMenuItem>
 </DropdownMenuContent>
 </DropdownMenu>
 </div>
 )
}
