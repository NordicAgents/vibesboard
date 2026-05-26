'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageHeader } from '@/components/ui/page-header'
import type {
  TenantDocument,
  TenantBrandingDocument
} from '@vibesboard/contracts'
import toast from 'react-hot-toast'

// Tab components
import { TenantOverviewTab } from './tabs/overview-tab'
import { TenantBrandingTab } from './tabs/branding-tab'
import { TenantFeaturesTab } from './tabs/features-tab'
import { TenantUsersTab } from './tabs/users-tab'
import { TenantAgentsTab } from './tabs/agents-tab'
import { TenantUsageTab } from './tabs/usage-tab'

interface PageProps {
  params: Promise<{ id: string }>
}

export default function TenantDetailPage({ params }: PageProps) {
  const router = useRouter()
  const [tenantId, setTenantId] = React.useState<string | null>(null)
  const [tenant, setTenant] = React.useState<TenantDocument | null>(null)
  const [branding, setBranding] = React.useState<TenantBrandingDocument | null>(
    null
  )
  const [loading, setLoading] = React.useState(true)

  // Unwrap params
  React.useEffect(() => {
    params.then(p => setTenantId(p.id))
  }, [params])

  const fetchTenant = React.useCallback(async () => {
    if (!tenantId) return

    try {
      setLoading(true)
      const response = await fetch(`/api/admin/tenants/${tenantId}`)

      if (!response.ok) {
        throw new Error('Failed to fetch tenant')
      }

      const data = await response.json()
      setTenant(data.tenant)
      setBranding(data.branding ?? null)
    } catch (error) {
      console.error('Error fetching tenant:', error)
      toast.error('Failed to load tenant details')
      router.push('/admin/tenants')
    } finally {
      setLoading(false)
    }
  }, [tenantId, router])

  React.useEffect(() => {
    if (tenantId) {
      fetchTenant()
    }
  }, [tenantId, fetchTenant])

  if (loading || !tenant) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="h-96 animate-pulse rounded bg-muted" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={tenant.name}
        description={`Manage ${tenant.name} tenant settings and configuration`}
        breadcrumbs={
          <nav className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/admin" className="hover:text-foreground">
              Admin
            </Link>
            <ChevronRight className="size-4" />
            <Link href="/admin/tenants" className="hover:text-foreground">
              Tenants
            </Link>
            <ChevronRight className="size-4" />
            <span className="text-foreground">{tenant.name}</span>
          </nav>
        }
      />

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="branding">Branding</TabsTrigger>
          <TabsTrigger value="features">Features</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="agents">Agents</TabsTrigger>
          <TabsTrigger value="usage">Usage</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <TenantOverviewTab tenant={tenant} onUpdate={fetchTenant} />
        </TabsContent>

        <TabsContent value="branding">
          <TenantBrandingTab
            tenantId={tenant.id}
            branding={branding}
            onUpdate={fetchTenant}
          />
        </TabsContent>

        <TabsContent value="features">
          <TenantFeaturesTab tenantId={tenant.id} />
        </TabsContent>

        <TabsContent value="users">
          <TenantUsersTab tenantId={tenant.id} tenantName={tenant.name} />
        </TabsContent>

        <TabsContent value="agents">
          <TenantAgentsTab tenantId={tenant.id} />
        </TabsContent>

        <TabsContent value="usage">
          <TenantUsageTab tenantId={tenant.id} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
