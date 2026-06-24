import { Badge } from '@vibesboard/web'

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
      <Badge>Default</Badge>
      <Badge variant="primary">Primary</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="destructive">Destructive</Badge>
      <Badge variant="outline">Outline</Badge>
    </div>
  )
}

export function StatusPills() {
  return (
    <div style={row}>
      <Badge variant="primary">Live</Badge>
      <Badge variant="secondary">Draft</Badge>
      <Badge variant="outline">Paused</Badge>
      <Badge variant="destructive">Error</Badge>
    </div>
  )
}

export function ChannelLabels() {
  return (
    <div style={row}>
      <Badge>WhatsApp</Badge>
      <Badge>Instagram</Badge>
      <Badge variant="outline">RAG</Badge>
      <Badge variant="secondary">Calendar</Badge>
    </div>
  )
}
