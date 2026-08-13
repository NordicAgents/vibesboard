import { Progress } from '@vibesboard/web'

const labelRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  fontSize: 13,
  marginBottom: 6,
}

export function UsageQuota() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 24, maxWidth: 360 }}>
      <div>
        <div style={labelRow}>
          <span style={{ fontWeight: 600 }}>Messages</span>
          <span className="text-muted-foreground">1,500 / 10,000</span>
        </div>
        <Progress value={15} />
      </div>
      <div>
        <div style={labelRow}>
          <span style={{ fontWeight: 600 }}>Knowledge storage</span>
          <span className="text-muted-foreground">450 / 1,000 MB</span>
        </div>
        <Progress value={45} />
      </div>
      <div>
        <div style={labelRow}>
          <span style={{ fontWeight: 600 }}>Agent runs</span>
          <span className="text-muted-foreground">8,000 / 10,000</span>
        </div>
        <Progress value={80} />
      </div>
    </div>
  )
}

export function FileUpload() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 24, maxWidth: 360 }}>
      <div>
        <div style={labelRow}>
          <span style={{ fontWeight: 600 }}>handbook.pdf</span>
          <span className="text-muted-foreground">Indexing… 64%</span>
        </div>
        <Progress value={64} className="h-1" />
      </div>
      <div>
        <div style={labelRow}>
          <span style={{ fontWeight: 600 }}>pricing.csv</span>
          <span className="text-muted-foreground">Complete</span>
        </div>
        <Progress value={100} className="h-1" />
      </div>
    </div>
  )
}
