'use client'

import * as React from 'react'
import { Plus, RefreshCw, Trash2, CheckCircle2, AlertCircle, Clock } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { DataTable, Column } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { Badge } from '@/components/ui/badge'
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

interface MessageTemplate {
  id: string
  business_account_id: string
  name: string
  category: string
  language: string
  body_text: string
  variables: string[]
  status: 'pending' | 'approved' | 'rejected'
  meta_template_id: string | null
  rejection_reason: string | null
  created_at: string
  updated_at: string
  business_account?: {
    display_name: string
    phone_number: string
  }
}

interface BusinessAccount {
  id: string
  display_name: string
  phone_number: string
  status: string
}

export default function TemplatesPage() {
  const [templates, setTemplates] = React.useState<MessageTemplate[]>([])
  const [businessAccounts, setBusinessAccounts] = React.useState<BusinessAccount[]>([])
  const [loading, setLoading] = React.useState(true)
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [selectedTemplate, setSelectedTemplate] = React.useState<MessageTemplate | null>(null)
  const [syncing, setSyncing] = React.useState<string | null>(null)

  // Form state
  const [formData, setFormData] = React.useState({
    businessAccountId: '',
    name: '',
    category: 'MARKETING',
    language: 'en',
    bodyText: '',
  })
  const [submitting, setSubmitting] = React.useState(false)

  const fetchData = React.useCallback(async () => {
    try {
      setLoading(true)

      // Get active tenant ID
      const response = await fetch('/api/tenants/current')
      if (!response.ok) throw new Error('Failed to get tenant')
      const { tenantId } = await response.json()

      // Fetch business accounts
      const accountsResponse = await fetch(`/api/tenants/${tenantId}/whatsapp-bulk/business-accounts`)
      if (accountsResponse.ok) {
        const accountsData = await accountsResponse.json()
        setBusinessAccounts(accountsData.accounts || [])

        // If we have accounts, fetch templates for the first account
        if (accountsData.accounts?.length > 0) {
          const firstAccountId = accountsData.accounts[0].id
          const templatesResponse = await fetch(`/api/whatsapp-bulk/business-accounts/${firstAccountId}/templates`)

          if (templatesResponse.ok) {
            const templatesData = await templatesResponse.json()
            setTemplates(templatesData.templates || [])
          }
        }
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

  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      setSubmitting(true)

      const response = await fetch(`/api/whatsapp-bulk/business-accounts/${formData.businessAccountId}/templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          category: formData.category,
          language: formData.language,
          body_text: formData.bodyText,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to create template')
      }

      toast.success('Template created and submitted to Meta for approval')
      setCreateDialogOpen(false)
      setFormData({
        businessAccountId: '',
        name: '',
        category: 'MARKETING',
        language: 'en',
        bodyText: '',
      })
      fetchData()
    } catch (error: any) {
      console.error('Error creating template:', error)
      toast.error(error.message || 'Failed to create template')
    } finally {
      setSubmitting(false)
    }
  }

  const handleSyncTemplate = async (template: MessageTemplate) => {
    try {
      setSyncing(template.id)

      const response = await fetch(`/api/whatsapp-bulk/templates/${template.id}/sync`, {
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error('Failed to sync template')
      }

      toast.success('Template synced successfully')
      fetchData()
    } catch (error) {
      console.error('Error syncing template:', error)
      toast.error('Failed to sync template')
    } finally {
      setSyncing(null)
    }
  }

  const handleDeleteTemplate = async () => {
    if (!selectedTemplate) return

    try {
      const response = await fetch(`/api/whatsapp-bulk/templates/${selectedTemplate.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to delete template')
      }

      toast.success('Template deleted successfully')
      setDeleteDialogOpen(false)
      setSelectedTemplate(null)
      fetchData()
    } catch (error) {
      console.error('Error deleting template:', error)
      toast.error('Failed to delete template')
    }
  }

  const extractVariables = (text: string): string[] => {
    const matches = text.match(/{{(\d+)}}/g) || []
    return matches.map(m => m.replace(/[{}]/g, ''))
  }

  const columns: Column<MessageTemplate>[] = [
    {
      key: 'name',
      label: 'Template',
      sortable: true,
      render: (template) => (
        <div className="flex flex-col gap-1">
          <span className="font-medium">{template.name}</span>
          <span className="text-xs text-muted-foreground">{template.business_account?.display_name}</span>
        </div>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      render: (template) => {
        const statusConfig = {
          approved: { variant: 'default' as const, icon: CheckCircle2, label: 'Approved' },
          pending: { variant: 'secondary' as const, icon: Clock, label: 'Pending' },
          rejected: { variant: 'destructive' as const, icon: AlertCircle, label: 'Rejected' },
        }
        const config = statusConfig[template.status]
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
      key: 'category',
      label: 'Category',
      render: (template) => template.category,
    },
    {
      key: 'language',
      label: 'Language',
      render: (template) => template.language.toUpperCase(),
    },
    {
      key: 'variables',
      label: 'Variables',
      render: (template) => template.variables?.length || 0,
    },
    {
      key: 'created_at',
      label: 'Created',
      sortable: true,
      render: (template) => new Date(template.created_at).toLocaleDateString(),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (template) => (
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              handleSyncTemplate(template)
            }}
            disabled={syncing === template.id}
            title="Sync status from Meta"
          >
            <RefreshCw className={`h-4 w-4 ${syncing === template.id ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              setSelectedTemplate(template)
              setDeleteDialogOpen(true)
            }}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ]

  const currentVariables = extractVariables(formData.bodyText)

  return (
    <>
      <PageHeader
        title="Message Templates"
        description="Create and manage WhatsApp message templates for your campaigns"
        actions={
          <Button onClick={() => setCreateDialogOpen(true)} disabled={businessAccounts.length === 0}>
            <Plus className="mr-2 h-4 w-4" />
            Create Template
          </Button>
        }
      />

      {businessAccounts.length === 0 ? (
        <EmptyState
          icon={AlertCircle}
          title="No business accounts"
          description="You need to connect a WhatsApp Business account before creating templates"
          action={
            <Button onClick={() => window.location.href = '/whatsapp-bulk/business-accounts'}>
              Connect Account
            </Button>
          }
        />
      ) : (
        <DataTable
          data={templates}
          columns={columns}
          searchable
          searchPlaceholder="Search templates..."
          searchKeys={['name', 'body_text']}
          pagination
          pageSize={10}
          loading={loading}
          emptyState={
            <EmptyState
              icon={Plus}
              title="No templates"
              description="Create your first message template to start sending campaigns"
              action={
                <Button onClick={() => setCreateDialogOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Template
                </Button>
              }
            />
          }
        />
      )}

      {/* Create Template Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <form onSubmit={handleCreateTemplate}>
            <DialogHeader>
              <DialogTitle>Create Message Template</DialogTitle>
              <DialogDescription>
                Templates must be approved by Meta before use. Use {{`{1}`}}, {{`{2}`}} for variables.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4 max-h-[60vh] overflow-y-auto">
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
                    {businessAccounts
                      .filter(acc => acc.status === 'active')
                      .map(account => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.display_name} ({account.phone_number})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="name">Template Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
                  placeholder="hello_world"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Only lowercase letters, numbers, and underscores
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="category">Category *</Label>
                  <Select
                    value={formData.category}
                    onValueChange={(value) => setFormData({ ...formData, category: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MARKETING">Marketing</SelectItem>
                      <SelectItem value="UTILITY">Utility</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="language">Language *</Label>
                  <Select
                    value={formData.language}
                    onValueChange={(value) => setFormData({ ...formData, language: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="es">Spanish</SelectItem>
                      <SelectItem value="fr">French</SelectItem>
                      <SelectItem value="de">German</SelectItem>
                      <SelectItem value="pt_BR">Portuguese (BR)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="bodyText">Message Body *</Label>
                <Textarea
                  id="bodyText"
                  value={formData.bodyText}
                  onChange={(e) => setFormData({ ...formData, bodyText: e.target.value })}
                  placeholder="Hello {{1}}, your order {{2}} is ready!"
                  rows={6}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Use {{`{1}`}}, {{`{2}`}}, etc. for variables. Max 1024 characters.
                </p>
                {currentVariables.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    <strong>Variables found:</strong> {currentVariables.join(', ')}
                  </div>
                )}
              </div>

              <div className="rounded-lg border p-4 bg-muted/50">
                <p className="text-sm font-medium mb-2">Preview</p>
                <p className="text-sm whitespace-pre-wrap">
                  {formData.bodyText.replace(/{{(\d+)}}/g, '[Variable $1]')}
                </p>
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
              <Button type="submit" disabled={submitting || !formData.businessAccountId}>
                {submitting ? 'Creating...' : 'Create & Submit'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Template?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the template "{selectedTemplate?.name}"?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteTemplate} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
