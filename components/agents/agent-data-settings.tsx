'use client'

import { useEffect, useState } from 'react'
import type { AgentDataConfig, DataFieldMapping } from '@/lib/firestore-types'
import type { CollectionField } from '@/lib/types'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import {
  Database,
  Plus,
  Trash2,
  Globe,
  Table2,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  Loader2
} from 'lucide-react'

interface DataConnectionSummary {
  id: string
  provider: string
  name: string
  status: string
  email?: string
  spreadsheetId?: string
  sheetName?: string
  baseId?: string
  tableId?: string
  tableName?: string
  webhookUrl?: string
  webhookMethod?: string
}

const DEFAULT_CONFIG: AgentDataConfig = {
  enabled: false,
  dataConnectionId: null,
  fieldMappings: [],
  autoSubmitOnComplete: true,
  updateKeyField: null
}

interface Props {
  config: AgentDataConfig | undefined
  onChange: (config: AgentDataConfig) => void
  disabled: boolean
  tenantId: string
  collectionFields?: CollectionField[]
}

type AddingType = 'airtable' | 'webhook' | null

export function AgentDataSettings({
  config,
  onChange,
  disabled,
  tenantId,
  collectionFields = []
}: Props) {
  const current = config ?? DEFAULT_CONFIG
  const [connections, setConnections] = useState<DataConnectionSummary[]>([])
  const [loadingConnections, setLoadingConnections] = useState(true)
  const [adding, setAdding] = useState<AddingType>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{
    id: string
    ok: boolean
    error?: string
  } | null>(null)

  // Form state for adding connections
  const [formName, setFormName] = useState('')
  const [formApiToken, setFormApiToken] = useState('')
  const [formBaseId, setFormBaseId] = useState('')
  const [formTableId, setFormTableId] = useState('')
  const [formTableName, setFormTableName] = useState('')
  const [formWebhookUrl, setFormWebhookUrl] = useState('')
  const [formWebhookMethod, setFormWebhookMethod] = useState<'POST' | 'PUT'>(
    'POST'
  )
  const [addingLoading, setAddingLoading] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const res = await fetch('/api/data/connections', {
          signal: controller.signal
        })
        if (!res.ok) return
        const data = await res.json()
        setConnections(data.connections ?? [])
      } catch {
        // ignore
      } finally {
        setLoadingConnections(false)
      }
    }
    load()
    return () => controller.abort()
  }, [tenantId])

  const update = (patch: Partial<AgentDataConfig>) => {
    onChange({ ...current, ...patch })
  }

  const handleConnectGoogleSheets = () => {
    window.location.href = '/api/data/auth/google-sheets'
  }

  const handleDisconnect = async (connectionId: string) => {
    try {
      await fetch(`/api/data/connections/${connectionId}`, {
        method: 'DELETE'
      })
      setConnections(prev => prev.filter(c => c.id !== connectionId))
      if (current.dataConnectionId === connectionId) {
        update({ dataConnectionId: null, enabled: false })
      }
    } catch {
      // ignore
    }
  }

  const handleTestConnection = async (connectionId: string) => {
    setTestingId(connectionId)
    setTestResult(null)
    try {
      const res = await fetch(
        `/api/data/connections/${connectionId}/test`,
        { method: 'POST' }
      )
      const data = await res.json()
      setTestResult({ id: connectionId, ok: data.ok, error: data.error })
    } catch {
      setTestResult({ id: connectionId, ok: false, error: 'Test failed' })
    } finally {
      setTestingId(null)
    }
  }

  const resetForm = () => {
    setFormName('')
    setFormApiToken('')
    setFormBaseId('')
    setFormTableId('')
    setFormTableName('')
    setFormWebhookUrl('')
    setFormWebhookMethod('POST')
    setAdding(null)
  }

  const handleAddConnection = async () => {
    if (!adding) return
    setAddingLoading(true)

    try {
      const body: Record<string, any> = { name: formName }

      if (adding === 'airtable') {
        body.provider = 'airtable'
        body.apiToken = formApiToken
        body.baseId = formBaseId
        body.tableId = formTableId
        body.tableName = formTableName || undefined
      } else {
        body.provider = 'custom_webhook'
        body.webhookUrl = formWebhookUrl
        body.webhookMethod = formWebhookMethod
      }

      const res = await fetch('/api/data/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? 'Failed to create connection')
      }

      const newConn = await res.json()
      setConnections(prev => [
        ...prev,
        { ...newConn, ...body, status: 'active' } as DataConnectionSummary
      ])
      resetForm()
    } catch {
      // ignore
    } finally {
      setAddingLoading(false)
    }
  }

  const handleAutoMap = () => {
    const mappings: DataFieldMapping[] = collectionFields.map(field => ({
      collectionFieldId: field.id,
      targetColumn: field.label
    }))
    update({ fieldMappings: mappings })
  }

  const updateMapping = (
    index: number,
    patch: Partial<DataFieldMapping>
  ) => {
    const updated = [...current.fieldMappings]
    updated[index] = { ...updated[index], ...patch }
    update({ fieldMappings: updated })
  }

  const activeConnections = connections.filter(c => c.status === 'active')

  const providerIcon = (provider: string) => {
    switch (provider) {
      case 'google_sheets':
        return <FileSpreadsheet className="size-4 text-green-600" />
      case 'airtable':
        return <Table2 className="size-4 text-blue-500" />
      case 'custom_webhook':
        return <Globe className="size-4 text-muted-foreground" />
      default:
        return <Database className="size-4 text-muted-foreground" />
    }
  }

  const providerLabel = (provider: string) => {
    switch (provider) {
      case 'google_sheets':
        return 'Google Sheets'
      case 'airtable':
        return 'Airtable'
      case 'custom_webhook':
        return 'Webhook'
      default:
        return provider
    }
  }

  return (
    <div className="space-y-5 pb-8">
      {/* Data Connections */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Data Connections</CardTitle>
          <CardDescription>
            Connect a data store to push collected data
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loadingConnections ? (
            <div className="flex h-16 items-center justify-center">
              <p className="text-xs text-muted-foreground">Loading...</p>
            </div>
          ) : (
            <>
              {connections.map(conn => (
                <div
                  key={conn.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex items-center gap-3">
                    {providerIcon(conn.provider)}
                    <div>
                      <p className="text-sm font-medium">{conn.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {providerLabel(conn.provider)}
                        {conn.email && ` \u00B7 ${conn.email}`}
                        {conn.webhookUrl &&
                          ` \u00B7 ${conn.webhookUrl.substring(0, 40)}...`}
                        {' \u00B7 '}
                        {conn.status}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Test button */}
                    <button
                      onClick={() => handleTestConnection(conn.id)}
                      disabled={disabled || testingId === conn.id}
                      className="rounded-md p-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                      title="Test connection"
                    >
                      {testingId === conn.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : testResult?.id === conn.id ? (
                        testResult.ok ? (
                          <CheckCircle2 className="size-3.5 text-green-600" />
                        ) : (
                          <XCircle className="size-3.5 text-destructive" />
                        )
                      ) : (
                        <span className="text-[10px]">Test</span>
                      )}
                    </button>
                    {/* Select radio */}
                    {conn.status === 'active' && (
                      <input
                        type="radio"
                        name="data-connection"
                        checked={current.dataConnectionId === conn.id}
                        onChange={() =>
                          update({ dataConnectionId: conn.id })
                        }
                        disabled={disabled}
                        className="accent-primary"
                      />
                    )}
                    {/* Delete */}
                    <button
                      onClick={() => handleDisconnect(conn.id)}
                      disabled={disabled}
                      className="rounded-md p-1 text-muted-foreground transition-colors hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              ))}

              {/* Add connection buttons */}
              {!adding && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleConnectGoogleSheets}
                    disabled={disabled}
                  >
                    <FileSpreadsheet className="mr-1.5 size-3.5" />
                    Google Sheets
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAdding('airtable')}
                    disabled={disabled}
                  >
                    <Table2 className="mr-1.5 size-3.5" />
                    Airtable
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAdding('webhook')}
                    disabled={disabled}
                  >
                    <Globe className="mr-1.5 size-3.5" />
                    Webhook
                  </Button>
                </div>
              )}

              {/* Airtable form */}
              {adding === 'airtable' && (
                <div className="space-y-2 rounded-lg border p-3">
                  <p className="text-sm font-medium">Add Airtable Connection</p>
                  <Input
                    placeholder="Connection name"
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    disabled={addingLoading}
                  />
                  <Input
                    placeholder="Personal access token"
                    type="password"
                    value={formApiToken}
                    onChange={e => setFormApiToken(e.target.value)}
                    disabled={addingLoading}
                  />
                  <Input
                    placeholder="Base ID (e.g. appXXXXXXXXXX)"
                    value={formBaseId}
                    onChange={e => setFormBaseId(e.target.value)}
                    disabled={addingLoading}
                  />
                  <Input
                    placeholder="Table ID (e.g. tblXXXXXXXXXX)"
                    value={formTableId}
                    onChange={e => setFormTableId(e.target.value)}
                    disabled={addingLoading}
                  />
                  <Input
                    placeholder="Table name (optional)"
                    value={formTableName}
                    onChange={e => setFormTableName(e.target.value)}
                    disabled={addingLoading}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={handleAddConnection}
                      disabled={
                        addingLoading ||
                        !formName ||
                        !formApiToken ||
                        !formBaseId ||
                        !formTableId
                      }
                    >
                      {addingLoading ? 'Adding...' : 'Add Connection'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={resetForm}
                      disabled={addingLoading}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {/* Webhook form */}
              {adding === 'webhook' && (
                <div className="space-y-2 rounded-lg border p-3">
                  <p className="text-sm font-medium">Add Webhook Connection</p>
                  <Input
                    placeholder="Connection name"
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    disabled={addingLoading}
                  />
                  <Input
                    placeholder="Webhook URL"
                    value={formWebhookUrl}
                    onChange={e => setFormWebhookUrl(e.target.value)}
                    disabled={addingLoading}
                  />
                  <select
                    value={formWebhookMethod}
                    onChange={e =>
                      setFormWebhookMethod(
                        e.target.value as 'POST' | 'PUT'
                      )
                    }
                    disabled={addingLoading}
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                  </select>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={handleAddConnection}
                      disabled={
                        addingLoading || !formName || !formWebhookUrl
                      }
                    >
                      {addingLoading ? 'Adding...' : 'Add Connection'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={resetForm}
                      disabled={addingLoading}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Enable Toggle */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Data Actions</CardTitle>
          <CardDescription>
            Let your agent submit and update data in external stores
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Enable data actions</p>
              <p className="text-xs text-muted-foreground">
                {activeConnections.length === 0
                  ? 'Add a data connection first'
                  : 'Agent can submit and update records'}
              </p>
            </div>
            <Switch
              checked={current.enabled}
              disabled={
                disabled ||
                activeConnections.length === 0 ||
                !current.dataConnectionId
              }
              onCheckedChange={enabled => update({ enabled })}
            />
          </div>

          {current.enabled && (
            <>
              {/* Field Mappings */}
              {collectionFields.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-muted-foreground">
                      Field Mappings
                    </label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleAutoMap}
                      disabled={disabled}
                      className="h-6 text-[10px]"
                    >
                      Auto-map from collection fields
                    </Button>
                  </div>
                  <div className="space-y-1.5">
                    {collectionFields.map((field, idx) => {
                      const mapping = current.fieldMappings.find(
                        m => m.collectionFieldId === field.id
                      )
                      const mappingIndex = current.fieldMappings.findIndex(
                        m => m.collectionFieldId === field.id
                      )

                      return (
                        <div
                          key={field.id}
                          className="flex items-center gap-2"
                        >
                          <span className="w-1/3 truncate text-xs text-muted-foreground">
                            {field.label}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            &rarr;
                          </span>
                          <Input
                            value={mapping?.targetColumn ?? ''}
                            onChange={e => {
                              if (mappingIndex >= 0) {
                                updateMapping(mappingIndex, {
                                  targetColumn: e.target.value
                                })
                              } else {
                                // Add new mapping
                                update({
                                  fieldMappings: [
                                    ...current.fieldMappings,
                                    {
                                      collectionFieldId: field.id,
                                      targetColumn: e.target.value
                                    }
                                  ]
                                })
                              }
                            }}
                            placeholder="Target column name"
                            disabled={disabled}
                            className="h-7 flex-1 text-xs"
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Auto-submit toggle */}
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">
                    Auto-submit on collection complete
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Automatically push data when all fields are collected
                  </p>
                </div>
                <Switch
                  checked={current.autoSubmitOnComplete}
                  disabled={disabled}
                  onCheckedChange={autoSubmitOnComplete =>
                    update({ autoSubmitOnComplete })
                  }
                />
              </div>

              {/* Update key field */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Update Key Field (optional)
                </label>
                <select
                  value={current.updateKeyField ?? ''}
                  onChange={e =>
                    update({
                      updateKeyField: e.target.value || null
                    })
                  }
                  disabled={disabled}
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                >
                  <option value="">None (append only)</option>
                  {current.fieldMappings.map(m => (
                    <option key={m.targetColumn} value={m.targetColumn}>
                      {m.targetColumn}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-muted-foreground">
                  Enable the update_record tool by selecting a field to use as a
                  lookup key
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
