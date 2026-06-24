import { Switch, Label } from '@vibesboard/web'

const wrap: React.CSSProperties = { padding: 24 }
const row: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
}
const settingRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  maxWidth: 320,
}
const stack: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  maxWidth: 320,
}

export function States() {
  return (
    <div style={{ ...wrap, ...row }}>
      <Switch defaultChecked aria-label="On" />
      <Switch aria-label="Off" />
      <Switch defaultChecked disabled aria-label="On disabled" />
      <Switch disabled aria-label="Off disabled" />
    </div>
  )
}

export function SettingsRow() {
  return (
    <div style={wrap}>
      <div style={settingRow}>
        <Label htmlFor="auto-reply">Enable auto-reply</Label>
        <Switch id="auto-reply" defaultChecked />
      </div>
    </div>
  )
}

export function SettingsList() {
  return (
    <div style={wrap}>
      <div style={stack}>
        <div style={settingRow}>
          <Label htmlFor="wa-channel">WhatsApp channel</Label>
          <Switch id="wa-channel" defaultChecked />
        </div>
        <div style={settingRow}>
          <Label htmlFor="ig-channel">Instagram inbox</Label>
          <Switch id="ig-channel" />
        </div>
        <div style={settingRow}>
          <Label htmlFor="human-handoff">Human handoff</Label>
          <Switch id="human-handoff" defaultChecked />
        </div>
      </div>
    </div>
  )
}
