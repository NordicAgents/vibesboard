import { Separator } from '@vibesboard/web'

export function Horizontal() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 24, maxWidth: 360 }}>
      <div>
        <p style={{ margin: 0, fontWeight: 600 }}>Knowledge base</p>
        <p className="text-sm text-muted-foreground" style={{ margin: '4px 0 0' }}>
          3 sources synced · 1,204 chunks indexed
        </p>
      </div>
      <Separator />
      <div>
        <p style={{ margin: 0, fontWeight: 600 }}>Calendar</p>
        <p className="text-sm text-muted-foreground" style={{ margin: '4px 0 0' }}>
          Connected to Google · availability live
        </p>
      </div>
    </div>
  )
}

export function Vertical() {
  return (
    <div style={{ padding: 24 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          height: 28,
        }}
        className="text-sm text-muted-foreground"
      >
        <span>WhatsApp</span>
        <Separator orientation="vertical" />
        <span>Instagram</span>
        <Separator orientation="vertical" />
        <span>Web chat</span>
      </div>
    </div>
  )
}
