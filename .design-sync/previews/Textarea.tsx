import { Textarea, Label } from '@vibesboard/web'

const wrap: React.CSSProperties = { padding: 24 }
const field: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  maxWidth: 420,
}

export function Labeled() {
  return (
    <div style={wrap}>
      <div style={field}>
        <Label htmlFor="system-prompt">System prompt</Label>
        <Textarea
          id="system-prompt"
          placeholder="You are a helpful agent that..."
        />
      </div>
    </div>
  )
}

export function Filled() {
  return (
    <div style={wrap}>
      <div style={field}>
        <Label htmlFor="instructions">Instructions</Label>
        <Textarea
          id="instructions"
          defaultValue={
            'You are the booking assistant for Acme Salon.\n\nAnswer only from the connected knowledge base. When a customer asks to book, check calendar availability and confirm the appointment over WhatsApp.\n\nKeep replies short and friendly.'
          }
        />
      </div>
    </div>
  )
}

export function Disabled() {
  return (
    <div style={wrap}>
      <div style={field}>
        <Label htmlFor="locked-prompt">Instructions</Label>
        <Textarea
          id="locked-prompt"
          defaultValue="Managed by template — edit the template to change this agent's behavior."
          disabled
        />
      </div>
    </div>
  )
}
