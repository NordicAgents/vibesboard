import { PageHeader, Button } from '@vibesboard/web'
import { Plus } from 'lucide-react'

export function WithAction() {
  return (
    <div style={{ padding: 24, maxWidth: 640 }}>
      <PageHeader
        title="Agents"
        description="Create, configure, and deploy AI agents for your workspace."
        actions={
          <Button>
            <Plus />
            New agent
          </Button>
        }
      />
    </div>
  )
}

export function WithBreadcrumbs() {
  return (
    <div style={{ padding: 24, maxWidth: 640 }}>
      <PageHeader
        breadcrumbs={
          <>
            <span>Settings</span>
            <span>/</span>
            <span>Usage</span>
          </>
        }
        title="Usage & billing"
        description="Monitor your message usage this billing cycle."
      />
    </div>
  )
}

export function TitleOnly() {
  return (
    <div style={{ padding: 24, maxWidth: 640 }}>
      <PageHeader title="Conversations" />
    </div>
  )
}
