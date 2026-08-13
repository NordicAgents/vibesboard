import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Button,
  Badge,
} from '@vibesboard/web'

const wrap: React.CSSProperties = { padding: 24, maxWidth: 420 }

export function Default() {
  return (
    <div style={wrap}>
      <Card>
        <CardHeader>
          <CardTitle>Support agent</CardTitle>
          <CardDescription>
            Answers customer questions from your knowledge base.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Connected to 3 sources · 1,204 messages handled this month.
          </p>
        </CardContent>
        <CardFooter style={{ gap: 8 }}>
          <Button size="sm">Open</Button>
          <Button size="sm" variant="outline">
            Configure
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}

export function WithBadge() {
  return (
    <div style={wrap}>
      <Card>
        <CardHeader>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <CardTitle>Booking assistant</CardTitle>
            <Badge>Live</Badge>
          </div>
          <CardDescription>Schedules appointments over WhatsApp.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Average response time 1.2s · 98% resolved without handoff.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

export function Plain() {
  return (
    <div style={wrap}>
      <Card>
        <CardContent style={{ paddingTop: 24 }}>
          <p className="text-sm text-foreground">
            A simple surface — Card on its own wraps any content in the
            design system&rsquo;s rounded, soft-shadowed container.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
