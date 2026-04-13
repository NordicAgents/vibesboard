'use client'

import { useState, useEffect } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { toast } from 'react-hot-toast'
import {
  Loader2,
  Plus,
  Headphones,
  MessageSquare,
  Trash2,
  Power,
  ExternalLink,
  Check,
  ChevronRight,
  Bot
} from 'lucide-react'

interface ChatwootConnection {
  id: string
  chatwootUrl: string
  chatwootAccountId: number
  chatwootInboxId: number
  chatwootInboxName: string
  status: 'active' | 'disconnected' | 'error'
  lastMessageReceivedAt?: string
  totalConversations: number
  disconnectedAt?: string
  disconnectionReason?: string
  errorMessage?: string
  useAgentBot?: boolean
  agentBotName?: string | null
  createdAt: string
}

interface ChatwootInbox {
  id: number
  name: string
  channel_type: string
}

interface AgentChatwootSettingsProps {
  agentId: string
  canEdit: boolean
  agentName?: string
}

export function AgentChatwootSettings({
  agentId,
  canEdit,
  agentName
}: AgentChatwootSettingsProps) {
  const [loading, setLoading] = useState(true)
  const [connections, setConnections] = useState<ChatwootConnection[]>([])

  // Setup wizard state
  const [showSetupModal, setShowSetupModal] = useState(false)
  const [setupStep, setSetupStep] = useState<
    'credentials' | 'inbox' | 'bot-config' | 'connecting' | 'done'
  >('credentials')
  const [chatwootUrl, setChatwootUrl] = useState('')
  const [apiToken, setApiToken] = useState('')
  const [validating, setValidating] = useState(false)
  const [inboxes, setInboxes] = useState<ChatwootInbox[]>([])
  const [selectedInboxId, setSelectedInboxId] = useState<number | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [accountId, setAccountId] = useState<number | null>(null)
  const [enableAgentBot, setEnableAgentBot] = useState(true)
  const [botName, setBotName] = useState(agentName || '')

  // Action modal states
  const [showDisconnectModal, setShowDisconnectModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [selectedConnection, setSelectedConnection] =
    useState<ChatwootConnection | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  useEffect(() => {
    loadConnections()
  }, [agentId])

  const loadConnections = async () => {
    try {
      setLoading(true)
      const res = await fetch(`/api/agents/${agentId}/chatwoot/connections`)
      if (!res.ok) throw new Error('Failed to load connections')
      const data = await res.json()
      setConnections(data.connections || [])
    } catch (error: any) {
      toast.error(error.message || 'Failed to load connections')
    } finally {
      setLoading(false)
    }
  }

  const resetSetupModal = () => {
    setSetupStep('credentials')
    setChatwootUrl('')
    setApiToken('')
    setInboxes([])
    setSelectedInboxId(null)
    setAccountId(null)
    setValidating(false)
    setConnecting(false)
    setEnableAgentBot(true)
    setBotName(agentName || '')
  }

  const handleValidate = async () => {
    if (!chatwootUrl.trim() || !apiToken.trim()) {
      toast.error('Please fill in both fields')
      return
    }

    try {
      setValidating(true)
      const res = await fetch(`/api/agents/${agentId}/chatwoot/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatwootUrl: chatwootUrl.trim(),
          apiToken: apiToken.trim()
        })
      })

      const data = await res.json()

      if (!res.ok || !data.valid) {
        toast.error(data.error || 'Invalid credentials')
        return
      }

      setAccountId(data.accountId)
      setInboxes(data.inboxes || [])

      if (data.inboxes.length === 0) {
        toast.error('No inboxes found in your Chatwoot account')
        return
      }

      setSetupStep('inbox')
    } catch (error: any) {
      toast.error(error.message || 'Validation failed')
    } finally {
      setValidating(false)
    }
  }

  const handleConnect = async () => {
    if (!selectedInboxId) {
      toast.error('Please select an inbox')
      return
    }

    try {
      setConnecting(true)
      setSetupStep('connecting')

      const res = await fetch(`/api/agents/${agentId}/chatwoot/connections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatwootUrl: chatwootUrl.trim(),
          apiToken: apiToken.trim(),
          inboxId: selectedInboxId,
          enableAgentBot,
          botName: enableAgentBot ? botName.trim() || undefined : undefined
        })
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create connection')
      }

      setSetupStep('done')
      loadConnections()
    } catch (error: any) {
      toast.error(error.message)
      setSetupStep('bot-config')
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    if (!selectedConnection) return

    try {
      setActionLoading(true)
      const res = await fetch(
        `/api/agents/${agentId}/chatwoot/connections/${selectedConnection.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'disconnect' })
        }
      )

      if (!res.ok) throw new Error('Failed to disconnect')

      toast.success('Connection disconnected')
      setShowDisconnectModal(false)
      setSelectedConnection(null)
      loadConnections()
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setActionLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedConnection) return

    try {
      setActionLoading(true)
      const res = await fetch(
        `/api/agents/${agentId}/chatwoot/connections/${selectedConnection.id}`,
        { method: 'DELETE' }
      )

      if (!res.ok) throw new Error('Failed to delete connection')

      toast.success('Connection deleted')
      setShowDeleteModal(false)
      setSelectedConnection(null)
      loadConnections()
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setActionLoading(false)
    }
  }

  const getStatusBadge = (status: string) => {
    const variants: Record<
      string,
      { variant: any; label: string; color: string }
    > = {
      active: {
        variant: 'default',
        label: 'Active',
        color: 'bg-green-500'
      },
      disconnected: {
        variant: 'outline',
        label: 'Disconnected',
        color: 'bg-gray-400'
      },
      error: {
        variant: 'destructive',
        label: 'Error',
        color: 'bg-red-500'
      }
    }

    const config = variants[status] || variants.error

    return (
      <div className="flex items-center gap-2">
        <div className={`size-2 rounded-full ${config.color}`} />
        <Badge variant={config.variant}>{config.label}</Badge>
      </div>
    )
  }

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return 'Never'
    const date = new Date(dateString)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 7) return date.toLocaleDateString()
    if (days > 0) return `${days}d ago`
    if (hours > 0) return `${hours}h ago`
    if (minutes > 0) return `${minutes}m ago`
    return 'Just now'
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  const activeConnections = connections.filter(c => c.status === 'active')
  const inactiveConnections = connections.filter(c => c.status !== 'active')

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Chatwoot Integration</CardTitle>
              <CardDescription>
                Connect to a Chatwoot inbox to handle customer conversations
              </CardDescription>
            </div>
            <Button
              onClick={() => {
                resetSetupModal()
                setShowSetupModal(true)
              }}
              disabled={!canEdit}
              size="sm"
            >
              <Plus className="mr-2 size-4" />
              Connect Inbox
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Stats Overview */}
          {connections.length > 0 && (
            <div className="grid grid-cols-2 gap-4 rounded-lg border bg-muted/50 p-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Active
                </p>
                <p className="text-2xl font-bold">{activeConnections.length}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Total Conversations
                </p>
                <p className="text-2xl font-bold">
                  {connections.reduce(
                    (sum, c) => sum + c.totalConversations,
                    0
                  )}
                </p>
              </div>
            </div>
          )}

          {/* Active Connections */}
          {activeConnections.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Active Connections</h3>
              <div className="space-y-2">
                {activeConnections.map(connection => (
                  <div
                    key={connection.id}
                    className="rounded-lg border p-4 transition-colors hover:bg-muted/50"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-3">
                          <Headphones className="size-4 text-muted-foreground" />
                          <span className="font-medium">
                            {connection.chatwootInboxName}
                          </span>
                          {connection.useAgentBot && (
                            <Badge variant="outline" className="gap-1">
                              <Bot className="size-3" />
                              {connection.agentBotName || 'Agent Bot'}
                            </Badge>
                          )}
                          {getStatusBadge(connection.status)}
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <ExternalLink className="size-3" />
                            {connection.chatwootUrl
                              .replace('https://', '')
                              .replace('http://', '')}
                          </div>
                          <div>
                            <MessageSquare className="mb-0.5 inline size-3" />{' '}
                            {connection.totalConversations} conversations
                          </div>
                          <div>
                            Last activity:{' '}
                            {formatDate(connection.lastMessageReceivedAt)}
                          </div>
                          <div>
                            Connected: {formatDate(connection.createdAt)}
                          </div>
                        </div>
                      </div>
                      {canEdit && (
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedConnection(connection)
                              setShowDisconnectModal(true)
                            }}
                          >
                            <Power className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedConnection(connection)
                              setShowDeleteModal(true)
                            }}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Inactive Connections */}
          {inactiveConnections.length > 0 && (
            <details className="space-y-3">
              <summary className="cursor-pointer text-sm font-semibold text-muted-foreground hover:text-foreground">
                Disconnected Connections ({inactiveConnections.length})
              </summary>
              <div className="space-y-2 pt-2">
                {inactiveConnections.map(connection => (
                  <div
                    key={connection.id}
                    className="rounded-lg border p-4 opacity-60 transition-colors hover:bg-muted/50"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-3">
                          <Headphones className="size-4 text-muted-foreground" />
                          <span className="font-medium">
                            {connection.chatwootInboxName}
                          </span>
                          {getStatusBadge(connection.status)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {connection.chatwootUrl
                            .replace('https://', '')
                            .replace('http://', '')}
                          {connection.disconnectionReason &&
                            ` - ${connection.disconnectionReason}`}
                        </div>
                      </div>
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedConnection(connection)
                            setShowDeleteModal(true)
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Empty State */}
          {connections.length === 0 && (
            <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed py-12 text-center">
              <Headphones className="mb-4 size-12 text-muted-foreground/50" />
              <h3 className="mb-2 text-lg font-semibold">
                No Chatwoot connections
              </h3>
              <p className="mb-4 text-sm text-muted-foreground">
                Connect a Chatwoot inbox to start handling customer
                conversations with your agent
              </p>
              <Button
                onClick={() => {
                  resetSetupModal()
                  setShowSetupModal(true)
                }}
                disabled={!canEdit}
              >
                <Plus className="mr-2 size-4" />
                Connect Your First Inbox
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Setup Wizard Modal */}
      <AlertDialog
        open={showSetupModal}
        onOpenChange={open => {
          if (!open && !connecting) {
            setShowSetupModal(false)
            resetSetupModal()
          }
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {setupStep === 'credentials' && 'Connect Chatwoot'}
              {setupStep === 'inbox' && 'Select Inbox'}
              {setupStep === 'bot-config' && 'Configure Agent Bot'}
              {setupStep === 'connecting' && 'Connecting...'}
              {setupStep === 'done' && 'Connected!'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {setupStep === 'credentials' &&
                'Enter your Chatwoot instance URL and API access token'}
              {setupStep === 'inbox' &&
                'Choose which inbox this agent should handle'}
              {setupStep === 'bot-config' &&
                'Choose how your agent responds in Chatwoot'}
              {setupStep === 'connecting' && 'Setting up the connection...'}
              {setupStep === 'done' &&
                'Your agent is now connected to Chatwoot'}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* Step 1: Credentials */}
          {setupStep === 'credentials' && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Chatwoot URL <span className="text-red-500">*</span>
                </label>
                <Input
                  value={chatwootUrl}
                  onChange={e => setChatwootUrl(e.target.value)}
                  placeholder="https://app.chatwoot.com"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  API Access Token <span className="text-red-500">*</span>
                </label>
                <Input
                  type="password"
                  value={apiToken}
                  onChange={e => setApiToken(e.target.value)}
                  placeholder="Paste your token here"
                />
                <p className="text-xs text-muted-foreground">
                  Go to Chatwoot &rarr; Profile Settings &rarr; Access Token.{' '}
                  <a
                    href="https://www.chatwoot.com/docs/product/user-guide/setting-up-access-token"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline"
                  >
                    How to get your token
                  </a>
                </p>
              </div>
            </div>
          )}

          {/* Step 2: Select Inbox */}
          {setupStep === 'inbox' && (
            <div className="space-y-3 py-4">
              <div className="max-h-60 space-y-2 overflow-y-auto">
                {inboxes.map(inbox => (
                  <button
                    key={inbox.id}
                    onClick={() => setSelectedInboxId(inbox.id)}
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${
                      selectedInboxId === inbox.id
                        ? 'border-primary bg-primary/5'
                        : 'hover:bg-muted/50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{inbox.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {inbox.channel_type
                            .replace('Channel::', '')
                            .replace(/([A-Z])/g, ' $1')
                            .trim()}
                        </p>
                      </div>
                      {selectedInboxId === inbox.id && (
                        <Check className="size-4 text-primary" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Bot Config */}
          {setupStep === 'bot-config' && (
            <div className="space-y-4 py-4">
              <button
                type="button"
                onClick={() => setEnableAgentBot(!enableAgentBot)}
                className={`w-full rounded-lg border p-4 text-left transition-colors ${
                  enableAgentBot
                    ? 'border-primary bg-primary/5'
                    : 'hover:bg-muted/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Bot className="size-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Create Agent Bot</p>
                      <p className="text-xs text-muted-foreground">
                        Bot gets its own identity and handles conversations
                        automatically
                      </p>
                    </div>
                  </div>
                  <div
                    className={`flex size-5 items-center justify-center rounded-full border-2 transition-colors ${
                      enableAgentBot
                        ? 'border-primary bg-primary'
                        : 'border-muted-foreground'
                    }`}
                  >
                    {enableAgentBot && (
                      <Check className="size-3 text-primary-foreground" />
                    )}
                  </div>
                </div>
              </button>

              {enableAgentBot && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Bot Name</label>
                  <Input
                    value={botName}
                    onChange={e => setBotName(e.target.value)}
                    placeholder="e.g. Support Bot"
                  />
                  <p className="text-xs text-muted-foreground">
                    This name will appear in Chatwoot when the bot replies.
                    Conversations can be handed off to human agents when needed.
                  </p>
                </div>
              )}

              {!enableAgentBot && (
                <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                  Replies will appear as your Chatwoot user account. No
                  automatic routing or handoff to human agents.
                </p>
              )}
            </div>
          )}

          {/* Step 4: Connecting */}
          {setupStep === 'connecting' && (
            <div className="flex flex-col items-center justify-center py-8">
              <Loader2 className="size-8 animate-spin text-primary" />
              <p className="mt-4 text-sm text-muted-foreground">
                Creating webhook and connecting to Chatwoot...
              </p>
            </div>
          )}

          {/* Step 4: Done */}
          {setupStep === 'done' && (
            <div className="flex flex-col items-center justify-center py-8">
              <div className="flex size-12 items-center justify-center rounded-full bg-green-100">
                <Check className="size-6 text-green-600" />
              </div>
              <p className="mt-4 text-sm font-medium">
                Connected to {inboxes.find(i => i.id === selectedInboxId)?.name}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Messages from this inbox will now be handled by your agent
              </p>
            </div>
          )}

          <AlertDialogFooter>
            {setupStep === 'credentials' && (
              <>
                <AlertDialogCancel disabled={validating}>
                  Cancel
                </AlertDialogCancel>
                <Button onClick={handleValidate} disabled={validating}>
                  {validating && (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  )}
                  Validate & Continue
                  <ChevronRight className="ml-1 size-4" />
                </Button>
              </>
            )}
            {setupStep === 'inbox' && (
              <>
                <Button
                  variant="outline"
                  onClick={() => setSetupStep('credentials')}
                >
                  Back
                </Button>
                <Button
                  onClick={() => setSetupStep('bot-config')}
                  disabled={!selectedInboxId}
                >
                  Continue
                  <ChevronRight className="ml-1 size-4" />
                </Button>
              </>
            )}
            {setupStep === 'bot-config' && (
              <>
                <Button variant="outline" onClick={() => setSetupStep('inbox')}>
                  Back
                </Button>
                <Button onClick={handleConnect} disabled={connecting}>
                  {connecting && (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  )}
                  Connect
                </Button>
              </>
            )}
            {setupStep === 'connecting' && (
              <Button disabled variant="outline">
                Please wait...
              </Button>
            )}
            {setupStep === 'done' && (
              <Button
                onClick={() => {
                  setShowSetupModal(false)
                  resetSetupModal()
                }}
              >
                Done
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Disconnect Modal */}
      <AlertDialog
        open={showDisconnectModal}
        onOpenChange={setShowDisconnectModal}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Chatwoot Inbox</AlertDialogTitle>
            <AlertDialogDescription>
              Disconnect &quot;{selectedConnection?.chatwootInboxName}&quot;
              from this agent? The webhook will be removed from Chatwoot.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionLoading}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisconnect}
              disabled={actionLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {actionLoading && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Modal */}
      <AlertDialog open={showDeleteModal} onOpenChange={setShowDeleteModal}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Connection</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently delete the connection to &quot;
              {selectedConnection?.chatwootInboxName}&quot;? This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionLoading}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={actionLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {actionLoading && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
