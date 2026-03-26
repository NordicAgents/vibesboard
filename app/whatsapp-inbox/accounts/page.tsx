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
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { FacebookSDKProvider } from '@/components/whatsapp-inbox/facebook-sdk-provider'
import { ConnectWhatsAppButton } from '@/components/whatsapp-inbox/connect-whatsapp-button'
import { ConnectApiKeyDialog } from '@/components/whatsapp-inbox/connect-api-key-dialog'
import { MessageSquare, Trash2, Key } from 'lucide-react'
import toast from 'react-hot-toast'

interface InboxAccount {
  id: string
  tenantId: string
  wabaId: string
  phoneNumberId: string
  displayPhoneNumber: string
  businessName: string
  status: string
  connectedAt: string
  webhookSubscribed: boolean
}

export default function WhatsAppInboxAccountsPage() {
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<InboxAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [disconnectId, setDisconnectId] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [apiKeyDialogOpen, setApiKeyDialogOpen] = useState(false)

  const fetchAccounts = useCallback(async () => {
    if (!tenantId) return
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/whatsapp-inbox/accounts`
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
      .then((r) => r.json())
      .then((data) => setTenantId(data.tenantId))
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
        `/api/tenants/${tenantId}/whatsapp-inbox/accounts/${disconnectId}`,
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

  const columns = [
    {
      key: 'businessName',
      label: 'Business',
      sortable: true,
      render: (account: InboxAccount) => (
        <div>
          <p className="font-medium text-foreground">{account.businessName}</p>
          <p className="text-xs text-muted-foreground">
            {account.displayPhoneNumber}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (account: InboxAccount) => (
        <Badge
          variant={account.status === 'active' ? 'default' : 'secondary'}
        >
          {account.status}
        </Badge>
      ),
    },
    {
      key: 'connectedAt',
      label: 'Connected',
      sortable: true,
      render: (account: InboxAccount) => (
        <span className="text-sm text-muted-foreground">
          {new Date(account.connectedAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (account: InboxAccount) => (
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => {
            e.stopPropagation()
            setDisconnectId(account.id)
          }}
          className="text-muted-foreground hover:text-red-600"
        >
          <Trash2 className="size-4" />
        </Button>
      ),
    },
  ]

  return (
    <FacebookSDKProvider>
      <div className="container max-w-5xl py-6">
        <PageHeader
          title="WhatsApp Accounts"
          description="Connect your WhatsApp Business Account via Meta to manage conversations."
          actions={
            tenantId ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => setApiKeyDialogOpen(true)}
                >
                  <Key className="mr-2 size-4" />
                  Connect via API Key
                </Button>
                <ConnectWhatsAppButton
                  tenantId={tenantId}
                  onSuccess={fetchAccounts}
                />
              </div>
            ) : undefined
          }
        />

        {!loading && accounts.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="No accounts connected"
            description="Connect your WhatsApp Business Account to start receiving and replying to customer messages."
            action={
              tenantId ? (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setApiKeyDialogOpen(true)}
                  >
                    <Key className="mr-2 size-4" />
                    Connect via API Key
                  </Button>
                  <ConnectWhatsAppButton
                    tenantId={tenantId}
                    onSuccess={fetchAccounts}
                  />
                </div>
              ) : undefined
            }
          />
        ) : (
          <DataTable
            data={accounts}
            columns={columns}
            loading={loading}
            searchKeys={['businessName', 'displayPhoneNumber']}
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
                This will stop receiving messages for this WhatsApp number.
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
      </div>

      <ConnectApiKeyDialog
        open={apiKeyDialogOpen}
        onOpenChange={setApiKeyDialogOpen}
        onSuccess={fetchAccounts}
      />
    </FacebookSDKProvider>
  )
}
