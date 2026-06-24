import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  Label,
  Input,
  Switch,
  Button,
} from '@vibesboard/web'

export function Open() {
  return (
    <Sheet open>
      <SheetContent side="right" style={{ width: 380 }}>
        <SheetHeader>
          <SheetTitle>Agent settings</SheetTitle>
          <SheetDescription>
            Configure how the support agent responds to customers.
          </SheetDescription>
        </SheetHeader>
        <div
          style={{
            marginTop: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Label htmlFor="sheet-name">Display name</Label>
            <Input id="sheet-name" defaultValue="Support agent" />
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <Label htmlFor="sheet-handoff">Hand off to a human</Label>
            <Switch id="sheet-handoff" defaultChecked />
          </div>
        </div>
        <SheetFooter style={{ marginTop: 28, gap: 8 }}>
          <Button variant="outline">Cancel</Button>
          <Button>Save changes</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
