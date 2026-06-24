import { CopyButton } from '@vibesboard/web'

const wrap: React.CSSProperties = { padding: 24, maxWidth: 520 }
const field: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
}

export function ApiKey() {
  return (
    <div style={wrap}>
      <div style={field}>
        <code className="font-mono text-sm text-foreground">
          vb_live_8x2Kd9aQ4mR7pZ1
        </code>
        <CopyButton text="vb_live_8x2Kd9aQ4mR7pZ1" />
      </div>
    </div>
  )
}

export function WebhookUrl() {
  return (
    <div style={wrap}>
      <div style={field}>
        <code className="font-mono text-sm text-foreground">
          https://api.vibesboard.ai/hooks/whatsapp/acme
        </code>
        <CopyButton
          text="https://api.vibesboard.ai/hooks/whatsapp/acme"
          label="Copy URL"
        />
      </div>
    </div>
  )
}
