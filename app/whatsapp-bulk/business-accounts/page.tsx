'use client'

import * as React from 'react'
import { Plus, RefreshCw, Trash2, CheckCircle2, AlertCircle, HelpCircle, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react'
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
  const [showHelp, setShowHelp] = React.useState(false)

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
            <Icon className="size-3" />
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
            <RefreshCw className={`size-4 ${syncing === account.id ? 'animate-spin' : ''}`} />
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
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="h-full overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="Business Accounts"
        description="Manage your WhatsApp Business accounts for bulk messaging"
        actions={
          <Button onClick={() => setConnectDialogOpen(true)}>
            <Plus className="mr-2 size-4" />
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
                <Plus className="mr-2 size-4" />
                Connect Account
              </Button>
            }
          />
        }
      />

      {/* Connect Account Dialog */}
      <Dialog open={connectDialogOpen} onOpenChange={setConnectDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
          <form onSubmit={handleConnectAccount}>
            <DialogHeader>
              <DialogTitle>Connect WhatsApp Business Account</DialogTitle>
              <DialogDescription>
                Enter your Meta WhatsApp Business credentials. You can find these in your Meta for Developers dashboard.
              </DialogDescription>
            </DialogHeader>

            {/* Help Guide Section */}
            <div className="my-4 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950">
              <button
                type="button"
                onClick={() => setShowHelp(!showHelp)}
                className="flex w-full items-center justify-between p-3 text-left"
              >
                <div className="flex items-center gap-2">
                  <HelpCircle className="size-5 text-blue-600 dark:text-blue-400" />
                  <span className="font-medium text-blue-900 dark:text-blue-100">
                    How to get these credentials?
                  </span>
                </div>
                {showHelp ? (
                  <ChevronUp className="size-5 text-blue-600 dark:text-blue-400" />
                ) : (
                  <ChevronDown className="size-5 text-blue-600 dark:text-blue-400" />
                )}
              </button>

              {showHelp && (
                <div className="space-y-4 border-t border-blue-200 p-4 text-sm dark:border-blue-900">
                  <div className="space-y-2">
                    <h4 className="flex items-center gap-2 font-semibold text-blue-900 dark:text-blue-100">
                      Step 1: Create Meta Business Account
                    </h4>
                    <p className="text-blue-800 dark:text-blue-200">
                      Visit{' '}
                      <a
                        href="https://business.facebook.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 underline hover:text-blue-600 dark:hover:text-blue-300"
                      >
                        business.facebook.com
                        <ExternalLink className="size-3" />
                      </a>{' '}
                      and create or select your existing business account.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <h4 className="flex items-center gap-2 font-semibold text-blue-900 dark:text-blue-100">
                      Step 2: Create WhatsApp Business App
                    </h4>
                    <ol className="ml-2 list-inside list-decimal space-y-1 text-blue-800 dark:text-blue-200">
                      <li>
                        Go to{' '}
                        <a
                          href="https://developers.facebook.com"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 underline hover:text-blue-600 dark:hover:text-blue-300"
                        >
                          developers.facebook.com
                          <ExternalLink className="size-3" />
                        </a>
                      </li>
                      <li>Click "My Apps" → "Create App"</li>
                      <li>Select "Business" → "WhatsApp"</li>
                      <li>Complete the app setup</li>
                    </ol>
                  </div>

                  <div className="space-y-2">
                    <h4 className="flex items-center gap-2 font-semibold text-blue-900 dark:text-blue-100">
                      Step 3: Get Phone Number ID & Business Account ID
                    </h4>
                    <ol className="ml-2 list-inside list-decimal space-y-1 text-blue-800 dark:text-blue-200">
                      <li>In your app dashboard, go to "WhatsApp" → "API Setup"</li>
                      <li>
                        Find <strong>"Phone Number ID"</strong> - a 15-digit number (e.g., 123456789012345)
                      </li>
                      <li>
                        Find <strong>"WhatsApp Business Account ID"</strong> - another 15-digit number
                      </li>
                      <li>Copy both IDs (you'll paste them in the form below)</li>
                    </ol>
                  </div>

                  <div className="space-y-2">
                    <h4 className="flex items-center gap-2 font-semibold text-blue-900 dark:text-blue-100">
                      Step 4: Generate Permanent Access Token
                    </h4>
                    <ol className="ml-2 list-inside list-decimal space-y-1 text-blue-800 dark:text-blue-200">
                      <li>In the same "API Setup" page, find "Access Token"</li>
                      <li>Click "Generate Access Token"</li>
                      <li>
                        Select or create a <strong>System User</strong>
                      </li>
                      <li>
                        Grant these permissions:
                        <ul className="ml-4 mt-1 list-inside list-disc">
                          <li>whatsapp_business_messaging</li>
                          <li>whatsapp_business_management</li>
                        </ul>
                      </li>
                      <li>
                        <strong>Important:</strong> Copy the token immediately - it's shown only once!
                      </li>
                      <li>Token format: starts with "EAA" (e.g., EAAxxxxxxxxxx)</li>
                    </ol>
                  </div>

                  <div className="rounded-md border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-900 dark:bg-yellow-950">
                    <p className="text-xs text-yellow-800 dark:text-yellow-200">
                      <strong>Security Note:</strong> Your access token will be encrypted with AES-256 before storage and never displayed again. Only the Phone Number ID and Business Account ID are stored in plain text.
                    </p>
                  </div>

                  <div className="pt-2">
                    <a
                      href="https://developers.facebook.com/docs/whatsapp/business-management-api/get-started"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      View detailed Meta documentation
                      <ExternalLink className="size-4" />
                    </a>
                  </div>
                </div>
              )}
            </div>

            <div className="grid gap-4">
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
    </div>
  )
}
