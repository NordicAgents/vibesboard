'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'react-hot-toast'
import { Loader2, Plus, Phone, MessageSquare, RotateCw, Trash2, Power, RefreshCw } from 'lucide-react'

interface WhatsAppConnection {
  id: string
  phone_number: string
  phone_number_normalized: string
  status: 'pending' | 'active' | 'disconnected' | 'expired'
  intro_message_sent_at: string | null
  last_message_received_at: string | null
  total_conversations: number
  connected_at: string | null
  disconnected_at: string | null
  disconnection_reason: string | null
  custom_intro_message: string | null
  created_at: string
}

interface AgentWhatsAppSettingsProps {
  agentId: string
  canEdit: boolean
}

export function AgentWhatsAppSettings({ agentId, canEdit }: AgentWhatsAppSettingsProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [connections, setConnections] = useState<WhatsAppConnection[]>([])

  // Add connection modal state
  const [showAddModal, setShowAddModal] = useState(false)
  const [addingConnection, setAddingConnection] = useState(false)
  const [newPhone, setNewPhone] = useState('')
  const [customIntro, setCustomIntro] = useState('')
  const [sendIntroImmediately, setSendIntroImmediately] = useState(true)

  // Action modal states
  const [showDisconnectModal, setShowDisconnectModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showReconnectModal, setShowReconnectModal] = useState(false)
  const [selectedConnection, setSelectedConnection] = useState<WhatsAppConnection | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [disconnectReason, setDisconnectReason] = useState('')
  const [conversationAction, setConversationAction] = useState<'keep' | 'archive' | 'delete'>('keep')

  // Load connections
  useEffect(() => {
    loadConnections()
  }, [agentId])

  const loadConnections = async () => {
    try {
      setLoading(true)
      const res = await fetch(`/api/agents/${agentId}/whatsapp/connections`)
      if (!res.ok) throw new Error('Failed to load connections')
      const data = await res.json()
      setConnections(data.connections || [])
    } catch (error: any) {
      toast.error(error.message || 'Failed to load connections')
    } finally {
      setLoading(false)
    }
  }

  const handleAddConnection = async () => {
    if (!newPhone.trim()) {
      toast.error('Please enter a phone number')
      return
    }

    // Validate E.164 format
    if (!/^\+[1-9]\d{7,14}$/.test(newPhone)) {
      toast.error('Invalid phone number format. Use E.164 format (e.g., +919400293288)')
      return
    }

    try {
      setAddingConnection(true)
      const res = await fetch(`/api/agents/${agentId}/whatsapp/connections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: newPhone,
          customIntroMessage: customIntro || undefined,
          sendIntroImmediately,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to add connection')
      }

      toast.success('Phone number connected successfully!')
      setShowAddModal(false)
      setNewPhone('')
      setCustomIntro('')
      setSendIntroImmediately(true)
      loadConnections()
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setAddingConnection(false)
    }
  }

  const handleDisconnect = async () => {
    if (!selectedConnection) return

    try {
      setActionLoading(true)
      const res = await fetch(
        `/api/agents/${agentId}/whatsapp/connections/${selectedConnection.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'disconnect',
            conversationAction,
            reason: disconnectReason || 'Manual disconnect',
          }),
        }
      )

      if (!res.ok) throw new Error('Failed to disconnect')

      toast.success('Connection disconnected')
      setShowDisconnectModal(false)
      setSelectedConnection(null)
      setDisconnectReason('')
      setConversationAction('keep')
      loadConnections()
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setActionLoading(false)
    }
  }

  const handleReconnect = async () => {
    if (!selectedConnection) return

    try {
      setActionLoading(true)
      const res = await fetch(
        `/api/agents/${agentId}/whatsapp/connections/${selectedConnection.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'reconnect',
            sendIntroMessage: true,
          }),
        }
      )

      if (!res.ok) throw new Error('Failed to reconnect')

      toast.success('Connection reconnected')
      setShowReconnectModal(false)
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
        `/api/agents/${agentId}/whatsapp/connections/${selectedConnection.id}`,
        {
          method: 'DELETE',
        }
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

  const handleResendIntro = async (connection: WhatsAppConnection) => {
    try {
      const res = await fetch(
        `/api/agents/${agentId}/whatsapp/connections/${connection.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'resend_intro',
          }),
        }
      )

      if (!res.ok) throw new Error('Failed to resend intro')

      toast.success('Introduction message sent')
      loadConnections()
    } catch (error: any) {
      toast.error(error.message)
    }
  }

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: any; label: string; color: string }> = {
      active: { variant: 'default', label: 'Active', color: 'bg-green-500' },
      pending: { variant: 'secondary', label: 'Pending', color: 'bg-yellow-500' },
      disconnected: { variant: 'outline', label: 'Disconnected', color: 'bg-gray-400' },
      expired: { variant: 'destructive', label: 'Expired', color: 'bg-red-500' },
    }

    const config = variants[status] || variants.pending

    return (
      <div className="flex items-center gap-2">
        <div className={`h-2 w-2 rounded-full ${config.color}`} />
        <Badge variant={config.variant}>{config.label}</Badge>
      </div>
    )
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Never'
    const date = new Date(dateString)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / 60)
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
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  const activeConnections = connections.filter((c) => c.status === 'active')
  const pendingConnections = connections.filter((c) => c.status === 'pending')
  const inactiveConnections = connections.filter(
    (c) => c.status === 'disconnected' || c.status === 'expired'
  )

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>WhatsApp Integration</CardTitle>
              <CardDescription>
                Connect phone numbers to receive messages via WhatsApp
              </CardDescription>
            </div>
            <Button
              onClick={() => setShowAddModal(true)}
              disabled={!canEdit}
              size="sm"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Phone Number
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Stats Overview */}
          {connections.length > 0 && (
            <div className="grid grid-cols-3 gap-4 rounded-lg border bg-muted/50 p-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Active</p>
                <p className="text-2xl font-bold">{activeConnections.length}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Conversations</p>
                <p className="text-2xl font-bold">
                  {connections.reduce((sum, c) => sum + c.total_conversations, 0)}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Pending</p>
                <p className="text-2xl font-bold">{pendingConnections.length}</p>
              </div>
            </div>
          )}

          {/* Active Connections */}
          {activeConnections.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Active Connections</h3>
              <div className="space-y-2">
                {activeConnections.map((connection) => (
                  <ConnectionCard
                    key={connection.id}
                    connection={connection}
                    canEdit={canEdit}
                    onDisconnect={() => {
                      setSelectedConnection(connection)
                      setShowDisconnectModal(true)
                    }}
                    onDelete={() => {
                      setSelectedConnection(connection)
                      setShowDeleteModal(true)
                    }}
                    onResendIntro={() => handleResendIntro(connection)}
                    getStatusBadge={getStatusBadge}
                    formatDate={formatDate}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Pending Connections */}
          {pendingConnections.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Pending Connections</h3>
              <div className="space-y-2">
                {pendingConnections.map((connection) => (
                  <ConnectionCard
                    key={connection.id}
                    connection={connection}
                    canEdit={canEdit}
                    onDisconnect={() => {
                      setSelectedConnection(connection)
                      setShowDisconnectModal(true)
                    }}
                    onDelete={() => {
                      setSelectedConnection(connection)
                      setShowDeleteModal(true)
                    }}
                    onResendIntro={() => handleResendIntro(connection)}
                    getStatusBadge={getStatusBadge}
                    formatDate={formatDate}
                  />
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
                {inactiveConnections.map((connection) => (
                  <ConnectionCard
                    key={connection.id}
                    connection={connection}
                    canEdit={canEdit}
                    onReconnect={() => {
                      setSelectedConnection(connection)
                      setShowReconnectModal(true)
                    }}
                    onDelete={() => {
                      setSelectedConnection(connection)
                      setShowDeleteModal(true)
                    }}
                    getStatusBadge={getStatusBadge}
                    formatDate={formatDate}
                  />
                ))}
              </div>
            </details>
          )}

          {/* Empty State */}
          {connections.length === 0 && (
            <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed py-12 text-center">
              <Phone className="mb-4 h-12 w-12 text-muted-foreground/50" />
              <h3 className="mb-2 text-lg font-semibold">No connections yet</h3>
              <p className="mb-4 text-sm text-muted-foreground">
                Add a phone number to start receiving WhatsApp messages
              </p>
              <Button onClick={() => setShowAddModal(true)} disabled={!canEdit}>
                <Plus className="mr-2 h-4 w-4" />
                Add Your First Number
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Connection Modal */}
      <AlertDialog open={showAddModal} onOpenChange={setShowAddModal}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Add WhatsApp Phone Number</AlertDialogTitle>
            <AlertDialogDescription>
              Connect a phone number to receive messages for this agent
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Phone Number <span className="text-red-500">*</span>
              </label>
              <Input
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="+919400293288"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Must be in E.164 format (e.g., +919400293288)
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Custom Introduction Message</label>
              <Textarea
                value={customIntro}
                onChange={(e) => setCustomIntro(e.target.value)}
                placeholder="Hi! I'm your agent. How can I help you today?"
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                Optional: Override the default agent greeting
              </p>
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="flex-1">
                <p className="text-sm font-medium">Send introduction immediately</p>
                <p className="text-xs text-muted-foreground">
                  Send a welcome message as soon as connected
                </p>
              </div>
              <Switch
                checked={sendIntroImmediately}
                onCheckedChange={setSendIntroImmediately}
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={addingConnection}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleAddConnection} disabled={addingConnection}>
              {addingConnection && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Connect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Disconnect Modal */}
      <AlertDialog open={showDisconnectModal} onOpenChange={setShowDisconnectModal}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Phone Number</AlertDialogTitle>
            <AlertDialogDescription>
              Disconnect {selectedConnection?.phone_number} from this agent
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">What should we do with conversations?</label>
              <div className="space-y-2">
                {[
                  { value: 'keep', label: 'Keep all conversations', desc: 'Conversations remain visible' },
                  { value: 'archive', label: 'Archive conversations', desc: 'Mark all as closed' },
                  { value: 'delete', label: 'Delete all conversations', desc: 'Permanently remove history' },
                ].map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setConversationAction(option.value as any)}
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${
                      conversationAction === option.value
                        ? 'border-primary bg-primary/5'
                        : 'hover:bg-muted/50'
                    }`}
                  >
                    <p className="text-sm font-medium">{option.label}</p>
                    <p className="text-xs text-muted-foreground">{option.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Reason (optional)</label>
              <Input
                value={disconnectReason}
                onChange={(e) => setDisconnectReason(e.target.value)}
                placeholder="E.g., No longer needed"
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisconnect}
              disabled={actionLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {actionLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reconnect Modal */}
      <AlertDialog open={showReconnectModal} onOpenChange={setShowReconnectModal}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reconnect Phone Number</AlertDialogTitle>
            <AlertDialogDescription>
              Reactivate {selectedConnection?.phone_number} and send a new introduction message
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleReconnect} disabled={actionLoading}>
              {actionLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reconnect
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
              Permanently delete {selectedConnection?.phone_number}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={actionLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {actionLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// Connection Card Component
function ConnectionCard({
  connection,
  canEdit,
  onDisconnect,
  onReconnect,
  onDelete,
  onResendIntro,
  getStatusBadge,
  formatDate,
}: {
  connection: WhatsAppConnection
  canEdit: boolean
  onDisconnect?: () => void
  onReconnect?: () => void
  onDelete?: () => void
  onResendIntro?: () => void
  getStatusBadge: (status: string) => JSX.Element
  formatDate: (date: string | null) => string
}) {
  const isActive = connection.status === 'active'
  const isPending = connection.status === 'pending'
  const isDisconnected = connection.status === 'disconnected' || connection.status === 'expired'

  return (
    <div className="rounded-lg border p-4 transition-colors hover:bg-muted/50">
      <div className="flex items-start justify-between">
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-3">
            <Phone className="h-4 w-4 text-muted-foreground" />
            <span className="font-mono font-medium">{connection.phone_number}</span>
            {getStatusBadge(connection.status)}
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {isActive && (
              <>
                <div>
                  <MessageSquare className="mb-1 inline h-3 w-3" /> {connection.total_conversations}{' '}
                  conversations
                </div>
                <div>Last activity: {formatDate(connection.last_message_received_at)}</div>
                <div>Connected: {formatDate(connection.connected_at)}</div>
              </>
            )}
            {isPending && (
              <>
                <div>Created: {formatDate(connection.created_at)}</div>
                <div>
                  {connection.intro_message_sent_at ? 'Intro sent' : 'Intro not sent yet'}
                </div>
              </>
            )}
            {isDisconnected && (
              <>
                <div>Disconnected: {formatDate(connection.disconnected_at)}</div>
                {connection.disconnection_reason && (
                  <div>Reason: {connection.disconnection_reason}</div>
                )}
              </>
            )}
          </div>
        </div>

        {canEdit && (
          <div className="flex gap-2">
            {isActive && (
              <>
                {onResendIntro && (
                  <Button variant="ghost" size="sm" onClick={onResendIntro}>
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                )}
                {onDisconnect && (
                  <Button variant="ghost" size="sm" onClick={onDisconnect}>
                    <Power className="h-4 w-4" />
                  </Button>
                )}
              </>
            )}
            {isPending && (
              <>
                {onResendIntro && (
                  <Button variant="ghost" size="sm" onClick={onResendIntro}>
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                )}
                {onDelete && (
                  <Button variant="ghost" size="sm" onClick={onDelete}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </>
            )}
            {isDisconnected && (
              <>
                {onReconnect && (
                  <Button variant="ghost" size="sm" onClick={onReconnect}>
                    <RotateCw className="h-4 w-4" />
                  </Button>
                )}
                {onDelete && (
                  <Button variant="ghost" size="sm" onClick={onDelete}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
