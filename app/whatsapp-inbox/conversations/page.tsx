'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { ConversationList } from '@/components/whatsapp-inbox/conversation-list'
import { MessageThread } from '@/components/whatsapp-inbox/message-thread'
import { Inbox, Search, MessageSquare, Bot } from 'lucide-react'
import type {
  WhatsAppInboxConversationDocument,
  WhatsAppInboxMessageDocument,
  InboxConversationStatus
} from '@/lib/firestore-types'

interface InboxAccount {
  id: string
  tenantId: string
  businessName: string
  displayPhoneNumber: string
  status: string
  assignedAgentId?: string | null
}

interface AgentOption {
  id: string
  name: string
}

export default function WhatsAppInboxConversationsPage() {
  const router = useRouter()
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<InboxAccount[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    null
  )
  const [conversations, setConversations] = useState<
    WhatsAppInboxConversationDocument[]
  >([])
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null)
  const [messages, setMessages] = useState<WhatsAppInboxMessageDocument[]>([])
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [agents, setAgents] = useState<AgentOption[]>([])
  const [assignedAgentId, setAssignedAgentId] = useState<string | null>(null)
  const [loadingAccounts, setLoadingAccounts] = useState(true)
  const [loadingConvos, setLoadingConvos] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const pollRef = useRef<NodeJS.Timeout>(null)

  // Fetch tenant
  useEffect(() => {
    fetch('/api/tenants/current')
      .then(r => r.json())
      .then(data => setTenantId(data.tenantId))
      .catch(() => {})
  }, [])

  // Fetch accounts
  useEffect(() => {
    if (!tenantId) return
    fetch(`/api/tenants/${tenantId}/whatsapp-inbox/accounts`)
      .then(r => r.json())
      .then(data => {
        const active = data.filter((a: InboxAccount) => a.status === 'active')
        setAccounts(active)
        if (active.length > 0 && !selectedAccountId) {
          setSelectedAccountId(active[0].id)
        }
      })
      .catch(() => {})
      .finally(() => setLoadingAccounts(false))
  }, [tenantId])

  // Fetch agents for assignment dropdown
  useEffect(() => {
    if (!tenantId) return
    fetch(`/api/agents?tenant_id=${tenantId}&limit=50`)
      .then(r => r.json())
      .then(data => {
        setAgents(
          (data.agents || []).map((a: any) => ({ id: a.id, name: a.name }))
        )
      })
      .catch(() => {})
  }, [tenantId])

  // Track assigned agent for selected account
  useEffect(() => {
    const account = accounts.find(a => a.id === selectedAccountId)
    setAssignedAgentId(account?.assignedAgentId || null)
  }, [selectedAccountId, accounts])

  const handleAssignAgent = async (agentId: string) => {
    if (!tenantId || !selectedAccountId) return
    const newAgentId = agentId === '__none__' ? null : agentId
    setAssignedAgentId(newAgentId)
    await fetch(
      `/api/tenants/${tenantId}/whatsapp-inbox/accounts/${selectedAccountId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedAgentId: newAgentId })
      }
    )
  }

  // Fetch conversations
  const fetchConversations = useCallback(async () => {
    if (!tenantId || !selectedAccountId) return
    setLoadingConvos(true)
    try {
      const statusParam =
        statusFilter !== 'all' ? `?status=${statusFilter}` : ''
      const res = await fetch(
        `/api/tenants/${tenantId}/whatsapp-inbox/accounts/${selectedAccountId}/conversations${statusParam}`
      )
      if (res.ok) {
        setConversations(await res.json())
      }
    } catch (err) {
      console.error('Failed to fetch conversations:', err)
    } finally {
      setLoadingConvos(false)
    }
  }, [tenantId, selectedAccountId, statusFilter])

  useEffect(() => {
    fetchConversations()
  }, [fetchConversations])

  // Fetch messages for selected conversation
  const fetchMessages = useCallback(async () => {
    if (!tenantId || !selectedAccountId || !selectedPhone) return
    setLoadingMessages(true)
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/whatsapp-inbox/accounts/${selectedAccountId}/conversations/${selectedPhone}/messages?limit=100`
      )
      if (res.ok) {
        setMessages(await res.json())
      }
    } catch (err) {
      console.error('Failed to fetch messages:', err)
    } finally {
      setLoadingMessages(false)
    }
  }, [tenantId, selectedAccountId, selectedPhone])

  useEffect(() => {
    fetchMessages()
  }, [fetchMessages])

  // Mark as read when selecting a conversation
  useEffect(() => {
    if (!tenantId || !selectedAccountId || !selectedPhone) return

    fetch(
      `/api/tenants/${tenantId}/whatsapp-inbox/accounts/${selectedAccountId}/conversations/${selectedPhone}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markAsRead: true })
      }
    ).catch(() => {})
  }, [tenantId, selectedAccountId, selectedPhone])

  // Poll for new messages every 5 seconds
  useEffect(() => {
    if (!selectedPhone) return

    pollRef.current = setInterval(() => {
      fetchMessages()
      fetchConversations()
    }, 5000)

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [selectedPhone, fetchMessages, fetchConversations])

  const handleMessageSent = () => {
    fetchMessages()
    fetchConversations()
  }

  const filteredConversations = search
    ? conversations.filter(
        c =>
          c.contactProfileName?.toLowerCase().includes(search.toLowerCase()) ||
          c.contactPhone.includes(search)
      )
    : conversations

  const selectedConversation = conversations.find(
    c => c.contactPhone === selectedPhone
  )

  // No accounts connected
  if (!loadingAccounts && accounts.length === 0) {
    return (
      <div className="container max-w-5xl py-6">
        <PageHeader title="WhatsApp Inbox" />
        <EmptyState
          icon={MessageSquare}
          title="No accounts connected"
          description="Connect a WhatsApp Business Account first to start receiving messages."
          action={
            <Button onClick={() => router.push('/whatsapp-inbox/accounts')}>
              Go to Accounts
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-64px)] flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <h2 className="font-sans text-lg font-semibold text-foreground">
            Inbox
          </h2>
          {accounts.length > 1 && (
            <Select
              value={selectedAccountId || ''}
              onValueChange={setSelectedAccountId}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Select account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map(acc => (
                  <SelectItem key={acc.id} value={acc.id}>
                    {acc.businessName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Bot className="size-4 text-muted-foreground" />
          <Select
            value={assignedAgentId || '__none__'}
            onValueChange={handleAssignAgent}
          >
            <SelectTrigger className="h-8 w-[180px] text-xs">
              <SelectValue placeholder="Assign Agent" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">No Agent</SelectItem>
              {agents.map(agent => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Main area: conversation list + message thread */}
      <div className="flex min-h-0 flex-1">
        {/* Left panel: conversations */}
        <div className="flex w-80 shrink-0 flex-col border-r border-border lg:w-96">
          {/* Search + filter */}
          <div className="space-y-2 border-b border-border p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search conversations..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Tabs value={statusFilter} onValueChange={setStatusFilter}>
              <TabsList className="w-full">
                <TabsTrigger value="all" className="flex-1">
                  All
                </TabsTrigger>
                <TabsTrigger value="open" className="flex-1">
                  Open
                </TabsTrigger>
                <TabsTrigger value="resolved" className="flex-1">
                  Resolved
                </TabsTrigger>
                <TabsTrigger value="snoozed" className="flex-1">
                  Snoozed
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <ConversationList
            conversations={filteredConversations}
            selectedPhone={selectedPhone}
            onSelect={setSelectedPhone}
          />
        </div>

        {/* Right panel: messages */}
        <div className="flex min-w-0 flex-1 flex-col">
          {selectedConversation && tenantId && selectedAccountId ? (
            <MessageThread
              tenantId={tenantId}
              accountId={selectedAccountId}
              conversation={selectedConversation}
              messages={messages}
              onMessageSent={handleMessageSent}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center">
                <Inbox className="mx-auto mb-3 size-12 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  Select a conversation to view messages
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
