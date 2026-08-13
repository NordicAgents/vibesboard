import { DataTable, Badge } from '@vibesboard/web'
import type { Column } from '@vibesboard/web'

const wrap: React.CSSProperties = { padding: 16, maxWidth: 720 }

interface Conversation {
  id: string
  contact: string
  channel: string
  agent: string
  messages: number
  status: string
}

const conversations: Conversation[] = [
  {
    id: '1',
    contact: 'Maria Lindqvist',
    channel: 'WhatsApp',
    agent: 'Support assistant',
    messages: 14,
    status: 'open',
  },
  {
    id: '2',
    contact: 'Tom Becker',
    channel: 'Instagram',
    agent: 'Booking bot',
    messages: 6,
    status: 'resolved',
  },
  {
    id: '3',
    contact: 'Aisha Khan',
    channel: 'WhatsApp',
    agent: 'Support assistant',
    messages: 21,
    status: 'escalated',
  },
  {
    id: '4',
    contact: 'Liam O’Brien',
    channel: 'Web widget',
    agent: 'Lead qualifier',
    messages: 3,
    status: 'open',
  },
  {
    id: '5',
    contact: 'Sofia Rossi',
    channel: 'Instagram',
    agent: 'Booking bot',
    messages: 9,
    status: 'resolved',
  },
]

const statusVariant: Record<
  string,
  'primary' | 'secondary' | 'destructive' | 'outline'
> = {
  open: 'primary',
  resolved: 'secondary',
  escalated: 'destructive',
}

const columns: Column<Conversation>[] = [
  {
    key: 'contact',
    label: 'Contact',
    sortable: true,
    render: c => <span className="font-medium">{c.contact}</span>,
  },
  { key: 'channel', label: 'Channel', sortable: true },
  { key: 'agent', label: 'Agent' },
  {
    key: 'messages',
    label: 'Messages',
    sortable: true,
    className: 'text-right',
  },
  {
    key: 'status',
    label: 'Status',
    sortable: true,
    render: c => (
      <Badge variant={statusVariant[c.status] ?? 'outline'} className="capitalize">
        {c.status}
      </Badge>
    ),
  },
]

export function Conversations() {
  return (
    <div style={wrap}>
      <DataTable
        data={conversations}
        columns={columns}
        searchable
        searchPlaceholder="Search conversations..."
        searchKeys={['contact', 'agent']}
        pagination
        pageSize={10}
      />
    </div>
  )
}
