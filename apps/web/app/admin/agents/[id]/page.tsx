import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CopyButton } from '@/components/ui/copy-button'
import { getAgentById } from '@vibesboard/agents/server'
import { type TenantDocument } from '@vibesboard/contracts'
import { getTenantById } from '@/lib/tenant-context'

export const runtime = 'nodejs'

export default async function AdminAgentPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const agent = await getAgentById(id)

  if (!agent) {
    notFound()
  }

  const tenantId = agent.tenantId ?? null

  let tenant: Pick<TenantDocument, 'id' | 'name' | 'slug'> | null = null
  if (tenantId) {
    const t = await getTenantById(tenantId)
    if (t) tenant = { id: t.id, name: t.name, slug: t.slug }
  }

  const sharePath = agent.allowAnonymous
    ? `/${agent.tenantSlug ?? 'unknown'}/${agent.agentUrl}`
    : null

  return (
    <div className="space-y-6">
      <PageHeader
        title={agent.name || 'Unnamed Agent'}
        description="Read-only agent viewer (super admin)"
        breadcrumbs={
          <nav className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/admin" className="hover:text-foreground">
              Admin
            </Link>
            <span>/</span>
            <span className="text-foreground">Agent</span>
          </nav>
        }
        actions={
          sharePath ? (
            <>
              <Link
                href={sharePath}
                className="rounded-md border px-3 py-2 text-sm hover:bg-muted"
              >
                Open Public Page
              </Link>
              <CopyButton text={sharePath} label="Copy Link" />
            </>
          ) : undefined
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
            <div>
              <div className="text-muted-foreground">Agent ID</div>
              <div className="font-mono">{agent.id}</div>
            </div>
            <CopyButton text={agent.id} label="Copy ID" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-md border p-3">
              <div className="text-muted-foreground">Tenant</div>
              {tenant ? (
                <Link
                  href={`/admin/tenants/${tenant.id}`}
                  className="hover:underline"
                >
                  {tenant.name}{' '}
                  <span className="text-muted-foreground">/{tenant.slug}</span>
                </Link>
              ) : (
                <div className="text-muted-foreground">None</div>
              )}
              {tenantId && (
                <div className="mt-1 font-mono text-xs text-muted-foreground">
                  {tenantId}
                </div>
              )}
            </div>

            <div className="rounded-md border p-3">
              <div className="text-muted-foreground">Owner User ID</div>
              <div className="font-mono text-xs">{agent.userId}</div>
            </div>

            <div className="rounded-md border p-3">
              <div className="text-muted-foreground">Agent URL</div>
              <div className="font-mono text-xs">{agent.agentUrl}</div>
            </div>

            <div className="rounded-md border p-3">
              <div className="text-muted-foreground">Allow Anonymous</div>
              <div>{agent.allowAnonymous ? 'Yes' : 'No'}</div>
            </div>

            <div className="rounded-md border p-3">
              <div className="text-muted-foreground">Created</div>
              <div>{new Date(agent.createdAt).toLocaleString()}</div>
            </div>

            <div className="rounded-md border p-3">
              <div className="text-muted-foreground">Last Updated</div>
              <div>{new Date(agent.updatedAt).toLocaleString()}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Instructions</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="whitespace-pre-wrap rounded-md border bg-muted/30 p-4 text-sm">
            {agent.instructions || '—'}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tools</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="overflow-auto rounded-md border bg-muted/30 p-4 text-sm">
            {JSON.stringify(agent.tools ?? [], null, 2)}
          </pre>
        </CardContent>
      </Card>
    </div>
  )
}
