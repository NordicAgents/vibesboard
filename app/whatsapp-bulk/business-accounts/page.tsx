'use client'

import * as React from 'react'
import { Plus, RefreshCw, Trash2, CheckCircle2, AlertCircle } from 'lucide-react'
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
import toast from 'react-hot-toast'

interface WhatsAppBusinessAccount {
  id: string
  tenant_id: string
  phone_number_id: string
  business_account_id: string
  display_name: string
  phone_number: string
  status: 'active' | 'pending' | 'disconnected'
  quality_rating: string | null
  messaging_limit: string | null
  created_at: string
  updated_at: string
}

export default function BusinessAccountsPage() {
  const [accounts, setAccounts] = React.useState<WhatsAppBusinessAccount[]>([])
  const [loading, setLoading] = React.useState(true)
  const [connectDialogOpen, setConnectDialogOpen] = React.useState(false)
  const [disconnectDialogOpen, setDisconnectDialogOpen] = React.useState(false)
  const [selectedAccount, setSelectedAccount] = React.useState<WhatsAppBusinessAccount | null>(null)
  const [syncing, setSyncing] = React.useState<string | null>(null)

  // Form state for connect dialog
  const [formData, setFormData] = React.useState({
    phoneNumberId: '',
    businessAccountId: '',
    accessToken: '',
    displayName: '',
  })
  const [submitting, setSubmitting] = React.useState(false)

  const fetchAccounts = React.useCallback(async () => {
    try {
      setLoading(true)

      // Get active tenant ID from cookie or context
      const response = await fetch('/api/tenants/current')
      if (!response.ok) throw new Error('Failed to get tenant')
      const { tenantId } = await response.json()

      const accountsResponse = await fetch(`/api/tenants/${tenantId}/whatsapp-bulk/business-accounts`)

      if (!accountsResponse.ok) {
        throw new Error('Failed to fetch business accounts')
      }

      const data = await accountsResponse.json()
      setAccounts(data.accounts || [])
    } catch (error) {
      console.error('Error fetching business accounts:', error)
      toast.error('Failed to load business accounts')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    fetchAccounts()
  }, [fetchAccounts])

  const handleConnectAccount = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      setSubmitting(true)

      // Get active tenant ID
      const response = await fetch('/api/tenants/current')
      if (!response.ok) throw new Error('Failed to get tenant')
      const { tenantId } = await response.json()

      const connectResponse = await fetch(`/api/tenants/${tenantId}/whatsapp-bulk/business-accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone_number_id: formData.phoneNumberId,
          business_account_id: formData.businessAccountId,
          access_token: formData.accessToken,
          display_name: formData.displayName || undefined,
        }),
      })

      if (!connectResponse.ok) {
        const error = await connectResponse.json()
        throw new Error(error.error || 'Failed to connect account')
      }

      toast.success('Business account connected successfully')
      setConnectDialogOpen(false)
      setFormData({
        phoneNumberId: '',
        businessAccountId: '',
        accessToken: '',
        displayName: '',
      })
      fetchAccounts()
    } catch (error: any) {
      console.error('Error connecting account:', error)
      toast.error(error.message || 'Failed to connect account')
    } finally {
      setSubmitting(false)
    }
  }

  const handleSyncAccount = async (account: WhatsAppBusinessAccount) => {
    try {
      setSyncing(account.id)

      const response = await fetch(`/api/whatsapp-bulk/business-accounts/${account.id}/sync`, {
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error('Failed to sync account')
      }

      toast.success('Account synced successfully')
      fetchAccounts()
    } catch (error) {
      console.error('Error syncing account:', error)
      toast.error('Failed to sync account')
    } finally {
      setSyncing(null)
    }
  }

  const handleDisconnectAccount = async () => {
    if (!selectedAccount) return

    try {
      const response = await fetch(`/api/whatsapp-bulk/business-accounts/${selectedAccount.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to disconnect account')
      }

      toast.success('Account disconnected successfully')
      setDisconnectDialogOpen(false)
      setSelectedAccount(null)
      fetchAccounts()
    } catch (error) {
      console.error('Error disconnecting account:', error)
      toast.error('Failed to disconnect account')
    }
  }

  const columns: Column<WhatsAppBusinessAccount>[] = [
    {
      key: 'display_name',
      label: 'Account',
      sortable: true,
      render: (account) => (
        <div className="flex flex-col gap-1">
          <span className="font-medium">{account.display_name}</span>
          <span className="text-xs text-muted-foreground">{account.phone_number}</span>
        </div>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      render: (account) => {
        const statusConfig = {
          active: { variant: 'default' as const, icon: CheckCircle2, label: 'Active' },
          pending: { variant: 'secondary' as const, icon: AlertCircle, label: 'Pending' },
          disconnected: { variant: 'destructive' as const, icon: Trash2, label: 'Disconnected' },
        }
        const config = statusConfig[account.status]
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
      key: 'quality_rating',
      label: 'Quality',
      render: (account) => account.quality_rating || 'N/A',
    },
    {
      key: 'messaging_limit',
      label: 'Limit',
      render: (account) => account.messaging_limit || 'N/A',
    },
    {
      key: 'created_at',
      label: 'Connected',
      sortable: true,
      render: (account) => new Date(account.created_at).toLocaleDateString(),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (account) => (
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              handleSyncAccount(account)
            }}
            disabled={syncing === account.id}
          >
            <RefreshCw className={`h-4 w-4 ${syncing === account.id ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              setSelectedAccount(account)
              setDisconnectDialogOpen(true)
            }}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Business Accounts"
        description="Manage your WhatsApp Business accounts for bulk messaging"
        actions={
          <Button onClick={() => setConnectDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Connect Account
          </Button>
        }
      />

      <DataTable
        data={accounts}
        columns={columns}
        searchable
        searchPlaceholder="Search by name or phone..."
        searchKeys={['display_name', 'phone_number']}
        pagination
        pageSize={10}
        loading={loading}
        emptyState={
          <EmptyState
            icon={Plus}
            title="No business accounts"
            description="Connect your first WhatsApp Business account to start sending campaigns"
            action={
              <Button onClick={() => setConnectDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Connect Account
              </Button>
            }
          />
        }
      />

      {/* Connect Account Dialog */}
      <Dialog open={connectDialogOpen} onOpenChange={setConnectDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <form onSubmit={handleConnectAccount}>
            <DialogHeader>
              <DialogTitle>Connect WhatsApp Business Account</DialogTitle>
              <DialogDescription>
                Enter your Meta WhatsApp Business credentials. You can find these in your Meta for Developers dashboard.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="phoneNumberId">Phone Number ID *</Label>
                <Input
                  id="phoneNumberId"
                  value={formData.phoneNumberId}
                  onChange={(e) => setFormData({ ...formData, phoneNumberId: e.target.value })}
                  placeholder="123456789012345"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="businessAccountId">Business Account ID *</Label>
                <Input
                  id="businessAccountId"
                  value={formData.businessAccountId}
                  onChange={(e) => setFormData({ ...formData, businessAccountId: e.target.value })}
                  placeholder="123456789012345"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="accessToken">Access Token *</Label>
                <Input
                  id="accessToken"
                  type="password"
                  value={formData.accessToken}
                  onChange={(e) => setFormData({ ...formData, accessToken: e.target.value })}
                  placeholder="EAAxxxx..."
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Your access token will be encrypted before storage
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="displayName">Display Name (Optional)</Label>
                <Input
                  id="displayName"
                  value={formData.displayName}
                  onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                  placeholder="My Business Account"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setConnectDialogOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Connecting...' : 'Connect Account'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Disconnect Confirmation Dialog */}
      <AlertDialog open={disconnectDialogOpen} onOpenChange={setDisconnectDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Account?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to disconnect {selectedAccount?.display_name}?
              This will stop all active campaigns using this account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDisconnectAccount} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
