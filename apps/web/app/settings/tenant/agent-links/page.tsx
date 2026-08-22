'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import toast from 'react-hot-toast'
import {
  Loader2,
  Plus,
  Link2,
  Pencil,
  Trash2,
  QrCode,
  Copy,
  ExternalLink
} from 'lucide-react'

interface AgentLink {
  id: string
  tenantId: string
  slug: string
  agentId: string
  name: string
  description?: string | null
  isActive: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
}

interface Agent {
  id: string
  name: string
  agentUrl: string
  allowAnonymous: boolean
}

export default function AgentLinksPage() {
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [tenantSlug, setTenantSlug] = useState<string>('')
  const [links, setLinks] = useState<AgentLink[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Create dialog state
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createSlug, setCreateSlug] = useState('')
  const [createAgentId, setCreateAgentId] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  // Edit dialog state
  const [editLink, setEditLink] = useState<AgentLink | null>(null)
  const [editName, setEditName] = useState('')
  const [editAgentId, setEditAgentId] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [isEditing, setIsEditing] = useState(false)

  // Share dialog state
  const [shareLink, setShareLink] = useState<AgentLink | null>(null)
  const [shareQr, setShareQr] = useState<string | null>(null)

  // Delete confirmation
  const [deleteLink, setDeleteLink] = useState<AgentLink | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true)

      const tenantResponse = await fetch('/api/user/active-tenant')
      if (!tenantResponse.ok) {
        toast.error('Failed to load tenant')
        return
      }
      const tenantData = await tenantResponse.json()
      if (!tenantData.tenant_id) {
        toast.error('No active tenant found')
        return
      }
      setTenantId(tenantData.tenant_id)

      const [configRes, linksRes, agentsRes] = await Promise.all([
        fetch(`/api/tenants/${tenantData.tenant_id}/config`),
        fetch(`/api/tenants/${tenantData.tenant_id}/agent-links`),
        fetch(`/api/agents?tenant_id=${tenantData.tenant_id}`)
      ])

      if (configRes.ok) {
        const config = await configRes.json()
        setTenantSlug(config.tenant?.slug || '')
      }

      if (linksRes.ok) {
        const data = await linksRes.json()
        setLinks(data.links || [])
      }

      if (agentsRes.ok) {
        const data = await agentsRes.json()
        setAgents(data.agents || [])
      }
    } catch (error) {
      console.error('Error fetching data:', error)
      toast.error('Failed to load agent links')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const getAgentName = (agentId: string) => {
    return agents.find(a => a.id === agentId)?.name ?? 'Unknown Agent'
  }

  const getLinkUrl = (link: AgentLink) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    return `${origin}/${tenantSlug}/l/${link.slug}`
  }

  const handleCreate = async () => {
    if (!tenantId) return
    setIsCreating(true)

    try {
      const response = await fetch(`/api/tenants/${tenantId}/agent-links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: createSlug,
          agentId: createAgentId,
          name: createName,
          description: createDescription || undefined
        })
      })

      if (response.ok) {
        toast.success('Agent link created')
        setShowCreateDialog(false)
        resetCreateForm()
        fetchData()
      } else {
        const data = await response.json()
        toast.error(data.error || 'Failed to create agent link')
      }
    } catch (error) {
      console.error('Error creating link:', error)
      toast.error('Failed to create agent link')
    } finally {
      setIsCreating(false)
    }
  }

  const resetCreateForm = () => {
    setCreateName('')
    setCreateSlug('')
    setCreateAgentId('')
    setCreateDescription('')
  }

  const openEditDialog = (link: AgentLink) => {
    setEditLink(link)
    setEditName(link.name)
    setEditAgentId(link.agentId)
    setEditDescription(link.description || '')
  }

  const handleEdit = async () => {
    if (!tenantId || !editLink) return
    setIsEditing(true)

    try {
      const response = await fetch(
        `/api/tenants/${tenantId}/agent-links/${editLink.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: editAgentId,
            name: editName,
            description: editDescription || null
          })
        }
      )

      if (response.ok) {
        toast.success('Agent link updated')
        setEditLink(null)
        fetchData()
      } else {
        const data = await response.json()
        toast.error(data.error || 'Failed to update agent link')
      }
    } catch (error) {
      console.error('Error updating link:', error)
      toast.error('Failed to update agent link')
    } finally {
      setIsEditing(false)
    }
  }

  const handleToggleActive = async (link: AgentLink) => {
    if (!tenantId) return

    try {
      const response = await fetch(
        `/api/tenants/${tenantId}/agent-links/${link.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive: !link.isActive })
        }
      )

      if (response.ok) {
        toast.success(link.isActive ? 'Link deactivated' : 'Link activated')
        fetchData()
      } else {
        const data = await response.json()
        toast.error(data.error || 'Failed to toggle link')
      }
    } catch (error) {
      toast.error('Failed to toggle link')
    }
  }

  const handleDelete = async () => {
    if (!tenantId || !deleteLink) return
    setIsDeleting(true)

    try {
      const response = await fetch(
        `/api/tenants/${tenantId}/agent-links/${deleteLink.id}`,
        { method: 'DELETE' }
      )

      if (response.ok) {
        toast.success('Agent link deleted')
        setDeleteLink(null)
        fetchData()
      } else {
        const data = await response.json()
        toast.error(data.error || 'Failed to delete agent link')
      }
    } catch (error) {
      toast.error('Failed to delete agent link')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleShare = (link: AgentLink) => {
    setShareLink(link)
    setShareQr(null)

    // Generate QR client-side using the API
    const url = getLinkUrl(link)
    import('qrcode')
      .then(QRCode => QRCode.toDataURL(url, { margin: 1, width: 512 }))
      .then(dataUrl => setShareQr(dataUrl))
      .catch(() => setShareQr(null))
  }

  const handleCopyUrl = (link: AgentLink) => {
    navigator.clipboard.writeText(getLinkUrl(link))
    toast.success('URL copied to clipboard')
  }

  const handleSlugFromName = (name: string) => {
    setCreateName(name)
    // Auto-generate slug from name
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    setCreateSlug(slug)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agent Links"
        description="Create stable URLs that can be redirected to different agents at any time"
        actions={
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="mr-2 size-4" />
            Create Link
          </Button>
        }
      />

      {links.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
              <Link2 className="size-6 text-muted-foreground" />
            </div>
            <h3 className="font-sans text-lg font-semibold">
              No agent links yet
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a link to get a stable URL you can print on QR codes
            </p>
            <Button className="mt-4" onClick={() => setShowCreateDialog(true)}>
              <Plus className="mr-2 size-4" />
              Create Your First Link
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {links.map(link => (
            <Card key={link.id}>
              <CardContent className="flex items-center gap-4 p-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Link2 className="size-5 text-muted-foreground" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">{link.name}</p>
                    <Badge variant={link.isActive ? 'default' : 'secondary'}>
                      {link.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                  <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                    /{tenantSlug}/l/{link.slug}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Connected to:{' '}
                    <span className="font-medium text-foreground">
                      {getAgentName(link.agentId)}
                    </span>
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleCopyUrl(link)}
                    title="Copy URL"
                  >
                    <Copy className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleShare(link)}
                    title="QR Code"
                  >
                    <QrCode className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => window.open(getLinkUrl(link), '_blank')}
                    title="Open link"
                  >
                    <ExternalLink className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleToggleActive(link)}
                    title={link.isActive ? 'Deactivate' : 'Activate'}
                  >
                    <div
                      className={`size-3 rounded-full ${link.isActive ? 'bg-green-500' : 'bg-gray-300'}`}
                    />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openEditDialog(link)}
                    title="Edit"
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeleteLink(link)}
                    title="Delete"
                  >
                    <Trash2 className="size-4 text-red-500" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Agent Link</DialogTitle>
            <DialogDescription>
              Create a stable URL that redirects to an agent. You can swap the
              connected agent at any time.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="create-name">Name</Label>
              <Input
                id="create-name"
                placeholder="e.g. Front Desk QR"
                value={createName}
                onChange={e => handleSlugFromName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="create-slug">Slug</Label>
              <Input
                id="create-slug"
                placeholder="e.g. front-desk"
                value={createSlug}
                onChange={e => setCreateSlug(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                URL will be: /{tenantSlug}/l/{createSlug || '...'}
              </p>
            </div>

            <div className="space-y-2">
              <Label>Connected Agent</Label>
              <Select value={createAgentId} onValueChange={setCreateAgentId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an agent" />
                </SelectTrigger>
                <SelectContent>
                  {agents.map(agent => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                      {!agent.allowAnonymous && ' (not public)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="create-description">Description (optional)</Label>
              <Textarea
                id="create-description"
                placeholder="Notes about this link..."
                value={createDescription}
                onChange={e => setCreateDescription(e.target.value)}
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setShowCreateDialog(false)
                resetCreateForm()
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={
                !createName || !createSlug || !createAgentId || isCreating
              }
            >
              {isCreating ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Link'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog
        open={!!editLink}
        onOpenChange={open => !open && setEditLink(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Agent Link</DialogTitle>
            <DialogDescription>
              Update the connected agent or link details. The slug cannot be
              changed to keep URLs stable.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-muted-foreground">Slug (read-only)</Label>
              <p className="font-mono text-sm">
                /{tenantSlug}/l/{editLink?.slug}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={e => setEditName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Connected Agent</Label>
              <Select value={editAgentId} onValueChange={setEditAgentId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an agent" />
                </SelectTrigger>
                <SelectContent>
                  {agents.map(agent => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                      {!agent.allowAnonymous && ' (not public)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-description">Description (optional)</Label>
              <Textarea
                id="edit-description"
                value={editDescription}
                onChange={e => setEditDescription(e.target.value)}
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditLink(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleEdit}
              disabled={!editName || !editAgentId || isEditing}
            >
              {isEditing ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Share / QR Dialog */}
      <Dialog
        open={!!shareLink}
        onOpenChange={open => !open && setShareLink(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share Agent Link</DialogTitle>
            <DialogDescription>
              Share this URL or QR code. The link stays the same even when you
              swap agents.
            </DialogDescription>
          </DialogHeader>

          {shareLink && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>URL</Label>
                <div className="flex gap-2">
                  <Input readOnly value={getLinkUrl(shareLink)} />
                  <Button
                    variant="secondary"
                    onClick={() => handleCopyUrl(shareLink)}
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
              </div>

              {shareQr && (
                <div className="flex flex-col items-center gap-3">
                  {/* `shareQr` is a client-generated data: URL. next/image
                      cannot optimize data URLs — it would need `unoptimized`,
                      which is next/image doing nothing at extra cost. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={shareQr}
                    alt="QR Code"
                    className="size-48 rounded-lg border"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      const a = document.createElement('a')
                      a.href = shareQr
                      a.download = `${shareLink.slug}-qr.png`
                      a.click()
                    }}
                  >
                    Download QR
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!deleteLink}
        onOpenChange={open => !open && setDeleteLink(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Agent Link</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{deleteLink?.name}&rdquo;?
              Anyone using the URL or QR code will get a 404 page. This cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteLink(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete Link'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
