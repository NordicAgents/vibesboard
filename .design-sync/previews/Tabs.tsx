import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Badge,
} from '@vibesboard/web'

const wrap: React.CSSProperties = { padding: 16, maxWidth: 480 }

export function AgentPanel() {
  return (
    <div style={wrap}>
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">
                Support assistant
              </span>
              <Badge variant="primary">Live</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Answers customer questions over WhatsApp. 1,204 conversations
              handled this month with a 1.2s average response time.
            </p>
          </div>
        </TabsContent>
        <TabsContent value="knowledge">
          <div className="flex flex-col gap-2">
            <p className="text-sm text-foreground">
              3 sources connected to the knowledge base.
            </p>
            <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
              <li>· product-handbook.pdf — 42 pages</li>
              <li>· refund-policy.md — indexed</li>
              <li>· help.acme.com — 128 pages crawled</li>
            </ul>
          </div>
        </TabsContent>
        <TabsContent value="settings">
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Model</span>
              <span className="font-mono text-foreground">gpt-5.4-nano</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Handoff to human</span>
              <span className="text-foreground">After 3 failed answers</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Language</span>
              <span className="text-foreground">Auto-detect</span>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
