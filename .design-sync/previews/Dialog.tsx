import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
  Input,
  Label,
} from '@vibesboard/web'

export function Open() {
  return (
    <Dialog open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a teammate</DialogTitle>
          <DialogDescription>
            They&rsquo;ll get access to this workspace&rsquo;s agents and shared
            inboxes.
          </DialogDescription>
        </DialogHeader>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Label htmlFor="invite-email">Email address</Label>
          <Input id="invite-email" placeholder="teammate@company.com" />
        </div>
        <DialogFooter style={{ gap: 8 }}>
          <Button variant="outline">Cancel</Button>
          <Button>Send invite</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
