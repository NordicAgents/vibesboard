import { Button } from '@vibesboard/web'
import { Plus, ArrowRight, Trash2 } from 'lucide-react'

const row: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 12,
  padding: 24,
}

export function Variants() {
  return (
    <div style={row}>
      <Button>Deploy agent</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="destructive">Delete</Button>
      <Button variant="link">Learn more</Button>
    </div>
  )
}

export function Sizes() {
  return (
    <div style={row}>
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="lg">Large</Button>
      <Button size="icon" aria-label="Add">
        <Plus />
      </Button>
    </div>
  )
}

export function WithIcons() {
  return (
    <div style={row}>
      <Button>
        <Plus />
        New agent
      </Button>
      <Button variant="outline">
        Continue
        <ArrowRight />
      </Button>
      <Button variant="ghost" size="icon" aria-label="Remove">
        <Trash2 />
      </Button>
    </div>
  )
}

export function States() {
  return (
    <div style={row}>
      <Button>Enabled</Button>
      <Button disabled>Disabled</Button>
      <Button variant="secondary" disabled>
        Disabled
      </Button>
    </div>
  )
}
