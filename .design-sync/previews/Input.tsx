import { Input, Label } from '@vibesboard/web'

const wrap: React.CSSProperties = { padding: 24 }
const field: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  maxWidth: 320,
}

export function Labeled() {
  return (
    <div style={wrap}>
      <div style={field}>
        <Label htmlFor="agent-name">Agent name</Label>
        <Input id="agent-name" placeholder="e.g. Support Bot" />
      </div>
    </div>
  )
}

export function Filled() {
  return (
    <div style={wrap}>
      <div style={field}>
        <Label htmlFor="webhook-url">Webhook URL</Label>
        <Input id="webhook-url" defaultValue="https://hooks.vibesboard.io/wa/inbound" />
      </div>
    </div>
  )
}

export function Disabled() {
  return (
    <div style={wrap}>
      <div style={field}>
        <Label htmlFor="workspace-slug">Workspace slug</Label>
        <Input id="workspace-slug" defaultValue="acme-support" disabled />
      </div>
    </div>
  )
}
