import { EmptyState, Button } from '@vibesboard/web'
import { Bot, Plus, Inbox } from 'lucide-react'

const wrap: React.CSSProperties = { padding: 16, maxWidth: 520 }

export function Default() {
  return (
    <div style={wrap}>
      <EmptyState
        icon={Bot}
        title="No agents yet"
        description="Create your first AI agent to start answering customer questions automatically."
        action={
          <Button>
            <Plus />
            New agent
          </Button>
        }
      />
    </div>
  )
}

export function NoAction() {
  return (
    <div style={wrap}>
      <EmptyState
        icon={Inbox}
        title="Inbox zero"
        description="You're all caught up — new conversations will appear here."
      />
    </div>
  )
}

export function TitleOnly() {
  return (
    <div style={wrap}>
      <EmptyState title="Nothing to show" />
    </div>
  )
}
