'use client'

import { useEffect, useState, useCallback } from 'react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { DataTable } from '@/components/ui/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { FacebookSDKProvider } from '@/components/whatsapp-inbox/facebook-sdk-provider'
import { ConnectInstagramButton } from '@/components/instagram-inbox/connect-instagram-button'
import { ConnectApiKeyDialog } from '@/components/instagram-inbox/connect-api-key-dialog'
import { ConnectByoaDialog } from '@/components/instagram-inbox/connect-byoa-dialog'
import { useTenantFeatures } from '@/hooks/use-tenant-features'
import { Instagram, Trash2, Key, Building2 } from 'lucide-react'
import toast from 'react-hot-toast'

interface InboxAccount {
  id: string
  tenantId: string
  instagramAccountId: string
  pageId: string
  pageName: string
  instagramUsername: string
  status: string
  connectedAt: string
  webhookSubscribed: boolean
  connectionMethod?: 'oauth' | 'api_key' | 'byoa'
}

export default function InstagramInboxAccountsPage() {
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<InboxAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [disconnectId, setDisconnectId] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [apiKeyDialogOpen, setApiKeyDialogOpen] = useState(false)
  const [byoaDialogOpen, setByoaDialogOpen] = useState(false)
  const { isEnabled, loading: featuresLoading } = useTenantFeatures(tenantId)

  const fetchAccounts = useCallback(async () => {
    if (!tenantId) return
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/instagram-inbox/accounts`
      )
      if (res.ok) {
        setAccounts(await res.json())
      }
    } catch (err) {
      console.error('Failed to fetch accounts:', err)
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => {
    fetch('/api/tenants/current')
      .then(r => r.json())
      .then(data => setTenantId(data.tenantId))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (tenantId) fetchAccounts()
  }, [tenantId, fetchAccounts])

  const handleDisconnect = async () => {
    if (!disconnectId || !tenantId) return
    setDisconnecting(true)
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/instagram-inbox/accounts/${disconnectId}`,
        { method: 'DELETE' }
      )
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to disconnect')
      }
      toast.success('Account disconnected')
      fetchAccounts()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setDisconnecting(false)
      setDisconnectId(null)
    }
  }

  const handleDelete = async () => {
    if (!deleteId || !tenantId) return
    setDeleting(true)
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/instagram-inbox/accounts/${deleteId}`,
        { method: 'DELETE' }
      )
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete')
      }
      toast.success('Account deleted')
      fetchAccounts()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setDeleting(false)
      setDeleteId(null)
    }
  }

  const columns = [
    {
      key: 'instagramUsername',
      label: 'Account',
      sortable: true,
      render: (account: InboxAccount) => (
        <div>
          <p className="font-medium text-foreground">
            @{account.instagramUsername}
          </p>
          <p className="text-xs text-muted-foreground">{account.pageName}</p>
        </div>
      )
    },
    {
      key: 'connectionMethod',
      label: 'Method',
      render: (account: InboxAccount) => {
        const method = account.connectionMethod || 'oauth'
        const labels: Record<string, string> = {
          oauth: 'OAuth',
          api_key: 'API Key',
          byoa: 'BYOA'
        }
        return <Badge variant="secondary">{labels[method] || method}</Badge>
      }
    },
    {
      key: 'status',
      label: 'Status',
      render: (account: InboxAccount) => (
        <Badge variant={account.status === 'active' ? 'default' : 'secondary'}>
          {account.status}
        </Badge>
      )
    },
    {
      key: 'connectedAt',
      label: 'Connected',
      sortable: true,
      render: (account: InboxAccount) => (
        <span className="text-sm text-muted-foreground">
          {new Date(account.connectedAt).toLocaleDateString()}
        </span>
      )
    },
    {
      key: 'actions',
      label: '',
      render: (account: InboxAccount) => (
        <Button
          variant="ghost"
          size="icon"
          onClick={e => {
            e.stopPropagation()
            if (account.status === 'disconnected') {
              setDeleteId(account.id)
            } else {
              setDisconnectId(account.id)
            }
          }}
          className="text-muted-foreground hover:text-red-600"
        >
          <Trash2 className="size-4" />
        </Button>
      )
    }
  ]

  return (
    <FacebookSDKProvider>
      <div className="container max-w-5xl py-6">
        <PageHeader
          title="Instagram Accounts"
          description="Connect your Instagram Business Account via Meta to manage conversations."
          actions={
            tenantId && !featuresLoading ? (
              <div className="flex items-center gap-2">
                {isEnabled('INSTAGRAM_INBOX_BYOA') && (
                  <Button
                    variant="outline"
                    onClick={() => setByoaDialogOpen(true)}
                  >
                    <Building2 className="mr-2 size-4" />
                    Connect via BYOA
                  </Button>
                )}
                {isEnabled('INSTAGRAM_INBOX_API_KEY') && (
                  <Button
                    variant="outline"
                    onClick={() => setApiKeyDialogOpen(true)}
                  >
                    <Key className="mr-2 size-4" />
                    Connect via API Key
                  </Button>
                )}
                {isEnabled('INSTAGRAM_INBOX_OAUTH') && (
                  <ConnectInstagramButton
                    tenantId={tenantId}
                    onSuccess={fetchAccounts}
                  />
                )}
              </div>
            ) : undefined
          }
        />

        {!loading && accounts.length === 0 ? (
          <EmptyState
            icon={Instagram}
            title="No accounts connected"
            description="Connect your Instagram Business Account to start receiving and replying to customer messages."
            action={
              tenantId && !featuresLoading ? (
                <div className="flex items-center gap-2">
                  {isEnabled('INSTAGRAM_INBOX_BYOA') && (
                    <Button
                      variant="outline"
                      onClick={() => setByoaDialogOpen(true)}
                    >
                      <Building2 className="mr-2 size-4" />
                      Connect via BYOA
                    </Button>
                  )}
                  {isEnabled('INSTAGRAM_INBOX_API_KEY') && (
                    <Button
                      variant="outline"
                      onClick={() => setApiKeyDialogOpen(true)}
                    >
                      <Key className="mr-2 size-4" />
                      Connect via API Key
                    </Button>
                  )}
                  {isEnabled('INSTAGRAM_INBOX_OAUTH') && (
                    <ConnectInstagramButton
                      tenantId={tenantId}
                      onSuccess={fetchAccounts}
                    />
                  )}
                </div>
              ) : undefined
            }
          />
        ) : (
          <DataTable
            data={accounts}
            columns={columns}
            loading={loading}
            searchKeys={['instagramUsername', 'pageName']}
            searchPlaceholder="Search accounts..."
          />
        )}

        <AlertDialog
          open={!!disconnectId}
          onOpenChange={() => setDisconnectId(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Disconnect account?</AlertDialogTitle>
              <AlertDialogDescription>
                This will stop receiving messages for this Instagram account.
                Existing conversations will be preserved.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="bg-red-600 hover:bg-red-700"
              >
                {disconnecting ? 'Disconnecting...' : 'Disconnect'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete account?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently remove this account from your workspace.
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                disabled={deleting}
                className="bg-red-600 hover:bg-red-700"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <ConnectApiKeyDialog
        open={apiKeyDialogOpen}
        onOpenChange={setApiKeyDialogOpen}
        onSuccess={fetchAccounts}
      />

      <ConnectByoaDialog
        open={byoaDialogOpen}
        onOpenChange={setByoaDialogOpen}
        onSuccess={fetchAccounts}
      />
    </FacebookSDKProvider>
  )
}
