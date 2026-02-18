'use client'

import * as React from 'react'
import { Plus, Play, Pause, Trash2, Clock, CheckCircle2, AlertCircle, TrendingUp } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { DataTable, Column } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import toast from 'react-hot-toast'

interface Campaign {
  id: string
  tenant_id: string
  name: string
  description: string | null
  template_id: string
  template_name: string
  business_account_id: string
  status: 'draft' | 'scheduled' | 'sending' | 'paused' | 'completed' | 'failed'
  messages_total: number
  messages_sent: number
  messages_delivered: number
  messages_read: number
  messages_failed: number
  scheduled_at: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  template?: {
    name: string
    body_text: string
  }
  business_account?: {
    display_name: string
  }
}

interface MessageTemplate {
  id: string
  name: string
  body_text: string
  variables: string[]
  status: string
}

interface BusinessAccount {
  id: string
  display_name: string
  phone_number: string
}

interface ContactList {
  id: string
  name: string
  contact_count: number
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = React.useState<Campaign[]>([])
  const [templates, setTemplates] = React.useState<MessageTemplate[]>([])
  const [businessAccounts, setBusinessAccounts] = React.useState<BusinessAccount[]>([])
  const [contactLists, setContactLists] = React.useState<ContactList[]>([])
  const [loading, setLoading] = React.useState(true)
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [selectedCampaign, setSelectedCampaign] = React.useState<Campaign | null>(null)

  // Form state
  const [formData, setFormData] = React.useState({
    name: '',
    description: '',
    businessAccountId: '',
    templateId: '',
    contactListIds: [] as string[],
    templateVariables: {} as Record<string, string>,
  })
  const [submitting, setSubmitting] = React.useState(false)

  const fetchData = React.useCallback(async () => {
    try {
      setLoading(true)

      const response = await fetch('/api/tenants/current')
      if (!response.ok) throw new Error('Failed to get tenant')
      const { tenantId } = await response.json()

      // Fetch all necessary data
      const [campaignsRes, accountsRes, listsRes] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/whatsapp-bulk/campaigns`),
        fetch(`/api/tenants/${tenantId}/whatsapp-bulk/business-accounts`),
        fetch(`/api/tenants/${tenantId}/whatsapp-bulk/contact-lists`),
      ])

      if (campaignsRes.ok) {
        const data = await campaignsRes.json()
        setCampaigns(data.campaigns || [])
      }

      if (accountsRes.ok) {
        const data = await accountsRes.json()
        const activeAccounts = (data.accounts || []).filter((acc: BusinessAccount) => acc)
        setBusinessAccounts(activeAccounts)

        // Fetch templates for first active account
        if (activeAccounts.length > 0) {
          const templatesRes = await fetch(
            `/api/whatsapp-bulk/business-accounts/${activeAccounts[0].id}/templates`
          )
          if (templatesRes.ok) {
            const templatesData = await templatesRes.json()
            setTemplates(
              (templatesData.templates || []).filter((t: MessageTemplate) => t.status === 'approved')
            )
          }
        }
      }

      if (listsRes.ok) {
        const data = await listsRes.json()
        setContactLists(data.lists || [])
      }
    } catch (error) {
      console.error('Error fetching data:', error)
      toast.error('Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      setSubmitting(true)

      const response = await fetch('/api/tenants/current')
      if (!response.ok) throw new Error('Failed to get tenant')
      const { tenantId } = await response.json()

      const createResponse = await fetch(`/api/tenants/${tenantId}/whatsapp-bulk/campaigns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          description: formData.description || undefined,
          business_account_id: formData.businessAccountId,
          template_id: formData.templateId,
          contact_list_ids: formData.contactListIds,
          template_variables: formData.templateVariables,
        }),
      })

      if (!createResponse.ok) {
        const error = await createResponse.json()
        throw new Error(error.error || 'Failed to create campaign')
      }

      toast.success('Campaign created successfully')
      setCreateDialogOpen(false)
      setFormData({
        name: '',
        description: '',
        businessAccountId: '',
        templateId: '',
        contactListIds: [],
        templateVariables: {},
      })
      fetchData()
    } catch (error: any) {
      console.error('Error creating campaign:', error)
      toast.error(error.message || 'Failed to create campaign')
    } finally {
      setSubmitting(false)
    }
  }

  const handleStartCampaign = async (campaign: Campaign) => {
    try {
      const response = await fetch(`/api/whatsapp-bulk/campaigns/${campaign.id}/start`, {
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error('Failed to start campaign')
      }

      toast.success('Campaign started')
      fetchData()
    } catch (error) {
      console.error('Error starting campaign:', error)
      toast.error('Failed to start campaign')
    }
  }

  const handlePauseCampaign = async (campaign: Campaign) => {
    try {
      const response = await fetch(`/api/whatsapp-bulk/campaigns/${campaign.id}/pause`, {
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error('Failed to pause campaign')
      }

      toast.success('Campaign paused')
      fetchData()
    } catch (error) {
      console.error('Error pausing campaign:', error)
      toast.error('Failed to pause campaign')
    }
  }

  const handleResumeCampaign = async (campaign: Campaign) => {
    try {
      const response = await fetch(`/api/whatsapp-bulk/campaigns/${campaign.id}/resume`, {
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error('Failed to resume campaign')
      }

      toast.success('Campaign resumed')
      fetchData()
    } catch (error) {
      console.error('Error resuming campaign:', error)
      toast.error('Failed to resume campaign')
    }
  }

  const handleDeleteCampaign = async () => {
    if (!selectedCampaign) return

    try {
      const response = await fetch(`/api/whatsapp-bulk/campaigns/${selectedCampaign.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to delete campaign')
      }

      toast.success('Campaign deleted successfully')
      setDeleteDialogOpen(false)
      setSelectedCampaign(null)
      fetchData()
    } catch (error) {
      console.error('Error deleting campaign:', error)
      toast.error('Failed to delete campaign')
    }
  }

  const selectedTemplate = templates.find(t => t.id === formData.templateId)

  const columns: Column<Campaign>[] = [
    {
      key: 'name',
      label: 'Campaign',
      sortable: true,
      render: (campaign) => (
        <div className="flex flex-col gap-1">
          <span className="font-medium">{campaign.name}</span>
          <span className="text-xs text-muted-foreground">{campaign.template_name}</span>
        </div>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      render: (campaign) => {
        const statusConfig = {
          draft: { variant: 'secondary' as const, icon: Clock, label: 'Draft' },
          scheduled: { variant: 'secondary' as const, icon: Clock, label: 'Scheduled' },
          sending: { variant: 'default' as const, icon: TrendingUp, label: 'Sending' },
          paused: { variant: 'secondary' as const, icon: Pause, label: 'Paused' },
          completed: { variant: 'default' as const, icon: CheckCircle2, label: 'Completed' },
          failed: { variant: 'destructive' as const, icon: AlertCircle, label: 'Failed' },
        }
        const config = statusConfig[campaign.status]
        const Icon = config.icon
        return (
          <Badge variant={config.variant} className="gap-1">
            <Icon className="h-3 w-3" />
            {config.label}
          </Badge>
        )
      },
    },
    {
      key: 'progress',
      label: 'Progress',
      render: (campaign) => {
        const total = campaign.messages_total || 0
        const sent = campaign.messages_sent || 0
        const percentage = total > 0 ? Math.round((sent / total) * 100) : 0
        return (
          <div className="flex flex-col gap-1">
            <Progress value={percentage} className="w-[100px]" />
            <span className="text-xs text-muted-foreground">
              {sent} / {total} ({percentage}%)
            </span>
          </div>
        )
      },
    },
    {
      key: 'delivered',
      label: 'Delivered',
      render: (campaign) => `${campaign.messages_delivered || 0}`,
    },
    {
      key: 'failed',
      label: 'Failed',
      render: (campaign) => {
        const failed = campaign.messages_failed || 0
        return (
          <span className={failed > 0 ? 'text-destructive' : ''}>
            {failed}
          </span>
        )
      },
    },
    {
      key: 'created_at',
      label: 'Created',
      sortable: true,
      render: (campaign) => new Date(campaign.created_at).toLocaleDateString(),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (campaign) => (
        <div className="flex gap-2">
          {campaign.status === 'draft' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                handleStartCampaign(campaign)
              }}
            >
              <Play className="h-4 w-4 text-green-600" />
            </Button>
          )}
          {campaign.status === 'sending' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                handlePauseCampaign(campaign)
              }}
            >
              <Pause className="h-4 w-4 text-orange-600" />
            </Button>
          )}
          {campaign.status === 'paused' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                handleResumeCampaign(campaign)
              }}
            >
              <Play className="h-4 w-4 text-green-600" />
            </Button>
          )}
          {campaign.status === 'draft' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                setSelectedCampaign(campaign)
                setDeleteDialogOpen(true)
              }}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          )}
        </div>
      ),
    },
  ]

  const canCreate = businessAccounts.length > 0 && templates.length > 0 && contactLists.length > 0

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Create and manage your WhatsApp bulk messaging campaigns"
        actions={
          <Button onClick={() => setCreateDialogOpen(true)} disabled={!canCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Create Campaign
          </Button>
        }
      />

      {!canCreate && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-base">Setup Required</CardTitle>
            <CardDescription>
              Complete these steps before creating a campaign:
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {businessAccounts.length === 0 && (
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-destructive" />
                <span>Connect a WhatsApp Business account</span>
              </div>
            )}
            {templates.length === 0 && (
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-destructive" />
                <span>Create and get approval for at least one message template</span>
              </div>
            )}
            {contactLists.length === 0 && (
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-destructive" />
                <span>Create at least one contact list with opted-in contacts</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <DataTable
        data={campaigns}
        columns={columns}
        searchable
        searchPlaceholder="Search campaigns..."
        searchKeys={['name', 'description']}
        pagination
        pageSize={10}
        loading={loading}
        emptyState={
          <EmptyState
            icon={Plus}
            title="No campaigns"
            description="Create your first bulk messaging campaign to reach your contacts"
            action={
              <Button onClick={() => setCreateDialogOpen(true)} disabled={!canCreate}>
                <Plus className="mr-2 h-4 w-4" />
                Create Campaign
              </Button>
            }
          />
        }
      />

      {/* Create Campaign Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <form onSubmit={handleCreateCampaign}>
            <DialogHeader>
              <DialogTitle>Create Campaign</DialogTitle>
              <DialogDescription>
                Set up a new bulk messaging campaign
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4 max-h-[60vh] overflow-y-auto">
              <div className="grid gap-2">
                <Label htmlFor="campaignName">Campaign Name *</Label>
                <Input
                  id="campaignName"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Summer Sale 2024"
                  required
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Promotional campaign for summer sale"
                  rows={2}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="businessAccount">Business Account *</Label>
                <Select
                  value={formData.businessAccountId}
                  onValueChange={(value) => setFormData({ ...formData, businessAccountId: value })}
                  required
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select an account" />
                  </SelectTrigger>
                  <SelectContent>
                    {businessAccounts.map(account => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.display_name} ({account.phone_number})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="template">Message Template *</Label>
                <Select
                  value={formData.templateId}
                  onValueChange={(value) => setFormData({ ...formData, templateId: value })}
                  required
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a template" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map(template => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedTemplate && (
                  <div className="rounded-lg border p-3 bg-muted/50 text-sm">
                    {selectedTemplate.body_text.replace(/{{(\d+)}}/g, '[Variable $1]')}
                  </div>
                )}
              </div>

              {selectedTemplate && selectedTemplate.variables.length > 0 && (
                <div className="grid gap-2">
                  <Label>Template Variables</Label>
                  {selectedTemplate.variables.map((variable) => (
                    <div key={variable} className="grid gap-2">
                      <Label htmlFor={`var-${variable}`} className="text-xs">
                        Variable {variable}
                      </Label>
                      <Input
                        id={`var-${variable}`}
                        value={formData.templateVariables[variable] || ''}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            templateVariables: {
                              ...formData.templateVariables,
                              [variable]: e.target.value,
                            },
                          })
                        }
                        placeholder={`Value for {{${variable}}}`}
                      />
                    </div>
                  ))}
                </div>
              )}

              <div className="grid gap-2">
                <Label>Contact Lists *</Label>
                <div className="space-y-2">
                  {contactLists.map(list => (
                    <div key={list.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id={`list-${list.id}`}
                        checked={formData.contactListIds.includes(list.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setFormData({
                              ...formData,
                              contactListIds: [...formData.contactListIds, list.id],
                            })
                          } else {
                            setFormData({
                              ...formData,
                              contactListIds: formData.contactListIds.filter(id => id !== list.id),
                            })
                          }
                        }}
                        className="rounded"
                      />
                      <Label htmlFor={`list-${list.id}`} className="cursor-pointer">
                        {list.name} ({list.contact_count} contacts)
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateDialogOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting || formData.contactListIds.length === 0}
              >
                {submitting ? 'Creating...' : 'Create Campaign'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedCampaign?.name}"?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteCampaign} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
