import { Label, Input, Switch } from '@vibesboard/web'

const wrap: React.CSSProperties = { padding: 24 }
const field: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  maxWidth: 320,
}
const settingRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  maxWidth: 320,
}

export function WithInput() {
  return (
    <div style={wrap}>
      <div style={field}>
        <Label htmlFor="greeting">Greeting message</Label>
        <Input id="greeting" placeholder="Hi! How can I help you today?" />
      </div>
    </div>
  )
}

export function WithSwitch() {
  return (
    <div style={wrap}>
      <div style={settingRow}>
        <Label htmlFor="auto-reply">Enable auto-reply</Label>
        <Switch id="auto-reply" defaultChecked />
      </div>
    </div>
  )
}
