import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  Button,
} from '@vibesboard/web'
import { Pencil, Copy, Power, Trash2 } from 'lucide-react'

export function Open() {
  return (
    <div style={{ padding: 24, minHeight: 280 }}>
      <DropdownMenu open>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">Actions</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Agent</DropdownMenuLabel>
          <DropdownMenuItem style={{ gap: 8 }}>
            <Pencil />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem style={{ gap: 8 }}>
            <Copy />
            Duplicate
            <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem style={{ gap: 8 }}>
            <Power />
            Pause
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem style={{ gap: 8 }}>
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
