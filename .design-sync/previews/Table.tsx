import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
  Badge,
} from '@vibesboard/web'

const wrap: React.CSSProperties = { padding: 16, maxWidth: 640 }

export function Agents() {
  return (
    <div style={wrap}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Agent</TableHead>
            <TableHead>Channel</TableHead>
            <TableHead className="text-right">Conversations</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="font-medium">Support assistant</TableCell>
            <TableCell>WhatsApp</TableCell>
            <TableCell className="text-right">1,204</TableCell>
            <TableCell>
              <Badge variant="primary">Live</Badge>
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="font-medium">Booking bot</TableCell>
            <TableCell>Instagram</TableCell>
            <TableCell className="text-right">486</TableCell>
            <TableCell>
              <Badge variant="primary">Live</Badge>
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="font-medium">Lead qualifier</TableCell>
            <TableCell>Web widget</TableCell>
            <TableCell className="text-right">73</TableCell>
            <TableCell>
              <Badge variant="secondary">Draft</Badge>
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="font-medium">FAQ responder</TableCell>
            <TableCell>WhatsApp</TableCell>
            <TableCell className="text-right">0</TableCell>
            <TableCell>
              <Badge variant="outline">Paused</Badge>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  )
}

export function WithFooter() {
  return (
    <div style={wrap}>
      <Table>
        <TableCaption>Usage for the current billing period.</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Channel</TableHead>
            <TableHead className="text-right">Messages</TableHead>
            <TableHead className="text-right">Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="font-medium">WhatsApp</TableCell>
            <TableCell className="text-right">8,420</TableCell>
            <TableCell className="text-right">$42.10</TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="font-medium">Instagram</TableCell>
            <TableCell className="text-right">3,190</TableCell>
            <TableCell className="text-right">$15.95</TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="font-medium">Web widget</TableCell>
            <TableCell className="text-right">1,002</TableCell>
            <TableCell className="text-right">$5.01</TableCell>
          </TableRow>
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>Total</TableCell>
            <TableCell className="text-right">12,612</TableCell>
            <TableCell className="text-right">$63.06</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  )
}
