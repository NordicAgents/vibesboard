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
          <Button variant="ghost" size="icon" className="h-9 w-9">
            <Settings className="h-5 w-5" />
            <span className="sr-only">User Settings</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          sideOffset={8}
          align="end"
          className="w-[180px]"
        >
          <DropdownMenuItem className="flex-col items-start">
            <div className="text-xs font-medium">{user?.name}</div>
            <div className="w-full truncate text-xs text-zinc-500">
              {user?.email}
            </div>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {canManageTenant && (
            <DropdownMenuItem asChild>
              <Link
                href="/settings/tenant"
                className="cursor-pointer text-xs"
              >
                Tenant Settings
              </Link>
            </DropdownMenuItem>
          )}
          {isSuperAdmin && (
            <DropdownMenuItem asChild>
              <Link href="/admin" className="cursor-pointer text-xs">
                Super Admin
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={handleSignOut}
            className="cursor-pointer text-xs"
          >
            Log Out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
