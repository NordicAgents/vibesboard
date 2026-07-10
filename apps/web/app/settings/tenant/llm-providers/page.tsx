'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import toast from 'react-hot-toast'
import { Plus, Trash2, Loader2, Star, Pencil } from 'lucide-react'

type ProviderKind = 'openai' | 'anthropic' | 'openai_compatible'

interface LlmConfig {
  id: string
  label: string
  kind: ProviderKind
  modelId: string
  baseUrl: string | null
  isEnabled: boolean
  isDefault: boolean
  createdAt: string
}

const KIND_LABELS: Record<ProviderKind, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  openai_compatible: 'OpenAI-Compatible',
}

const KIND_COLORS: Record<ProviderKind, string> = {
  openai: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  anthropic: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  openai_compatible: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
}

const DEFAULT_MODELS: Record<ProviderKind, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-5',
  openai_compatible: 'llama-3.3-70b-versatile',
}

interface FormState {
  label: string
  kind: ProviderKind
  modelId: string
  apiKey: string
  baseUrl: string
  isDefault: boolean
}

const emptyForm = (): FormState => ({
  label: '',
  kind: 'openai',
  modelId: 'gpt-4o',
  apiKey: '',
  baseUrl: '',
  isDefault: false,
})

type Mode = { type: 'idle' } | { type: 'add' } | { type: 'edit'; id: string }

export default function LlmProvidersPage() {
  const [configs, setConfigs] = useState<LlmConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<Mode>({ type: 'idle' })
  const [form, setForm] = useState<FormState>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/tenants/llm-configs')
      if (!res.ok) throw new Error('Failed to load')
      setConfigs((await res.json()).configs)
    } catch {
      toast.error('Failed to load provider configs')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const openAdd = () => { setForm(emptyForm()); setMode({ type: 'add' }) }
  const openEdit = (cfg: LlmConfig) => {
    setForm({
      label: cfg.label,
      kind: cfg.kind,
      modelId: cfg.modelId,
      apiKey: '',           // never pre-filled — user must re-enter to rotate
      baseUrl: cfg.baseUrl ?? '',
      isDefault: cfg.isDefault,
    })
    setMode({ type: 'edit', id: cfg.id })
  }
  const closeForm = () => { setMode({ type: 'idle' }); setForm(emptyForm()) }

  const handleKindChange = (kind: ProviderKind) => {
    setForm(f => ({ ...f, kind, modelId: DEFAULT_MODELS[kind] }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const isEdit = mode.type === 'edit'
      const url = isEdit ? `/api/tenants/llm-configs/${(mode as { id: string }).id}` : '/api/tenants/llm-configs'
      const method = isEdit ? 'PATCH' : 'POST'

      const body: Record<string, unknown> = {
        label: form.label,
        kind: form.kind,
        modelId: form.modelId,
        isDefault: form.isDefault,
      }
      // Only send apiKey if the user typed one (edit: leave blank to keep existing key)
      if (form.apiKey) body.apiKey = form.apiKey
      if (form.kind === 'openai_compatible' && form.baseUrl) body.baseUrl = form.baseUrl
      // For non-edit, apiKey is always required (enforced by schema)
      if (!isEdit && !form.apiKey) {
        toast.error('API key is required')
        setSaving(false)
        return
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Failed to save')
      }
      toast.success(isEdit ? 'Provider updated' : 'Provider added')
      closeForm()
      await load()
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async (id: string) => {
    setTesting(id)
    try {
      const res = await fetch(`/api/tenants/llm-configs/${id}/test`, { method: 'POST' })
      const data = await res.json()
      if (data.ok) toast.success('Connection successful!')
      else toast.error(`Connection failed: ${data.error ?? 'Unknown error'}`)
    } catch {
      toast.error('Test request failed')
    } finally {
      setTesting(null)
    }
  }

  const handleSetDefault = async (id: string) => {
    try {
      const res = await fetch(`/api/tenants/llm-configs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isDefault: true }),
      })
      if (!res.ok) throw new Error()
      toast.success('Default provider updated')
      await load()
    } catch {
      toast.error('Failed to set default')
    }
  }

  const handleToggle = async (id: string, isEnabled: boolean) => {
    try {
      await fetch(`/api/tenants/llm-configs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isEnabled }),
      })
      await load()
    } catch {
      toast.error('Failed to update')
    }
  }

  const handleDelete = async (id: string) => {
    setDeleting(id)
    try {
      const res = await fetch(`/api/tenants/llm-configs/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast.success('Provider removed')
      await load()
    } catch {
      toast.error('Failed to delete')
    } finally {
      setDeleting(null)
    }
  }

  const isFormOpen = mode.type !== 'idle'
  const isEditMode = mode.type === 'edit'

  return (
    <div className="space-y-6">
      <PageHeader
        title="LLM Providers"
        description="Connect your own AI provider so agents in this workspace use your API key and model."
      />

      <div className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : configs.length === 0 && !isFormOpen ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No providers configured. Agents use the platform default model.
            </CardContent>
          </Card>
        ) : (
          configs.map(cfg => (
            <Card key={cfg.id} className={cfg.isEnabled ? '' : 'opacity-60'}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CardTitle className="text-base">{cfg.label}</CardTitle>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${KIND_COLORS[cfg.kind]}`}>
                      {KIND_LABELS[cfg.kind]}
                    </span>
                    {cfg.isDefault && (
                      <Badge variant="secondary" className="gap-1">
                        <Star className="h-3 w-3" /> Default
                      </Badge>
                    )}
                    {!cfg.isEnabled && <Badge variant="outline">Disabled</Badge>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="sm" onClick={() => handleTest(cfg.id)} disabled={testing === cfg.id}>
                      {testing === cfg.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Test'}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(cfg)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {!cfg.isDefault && (
                      <Button variant="ghost" size="sm" onClick={() => handleSetDefault(cfg.id)}>
                        Set default
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => handleToggle(cfg.id, !cfg.isEnabled)}>
                      {cfg.isEnabled ? 'Disable' : 'Enable'}
                    </Button>
                    <Button
                      variant="ghost" size="sm"
                      onClick={() => handleDelete(cfg.id)}
                      disabled={deleting === cfg.id}
                      className="text-destructive hover:text-destructive"
                    >
                      {deleting === cfg.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                <CardDescription className="text-xs">
                  {cfg.modelId}{cfg.baseUrl && ` · ${cfg.baseUrl}`}
                </CardDescription>
              </CardHeader>
            </Card>
          ))
        )}

        {isFormOpen && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{isEditMode ? 'Edit Provider' : 'Add Provider'}</CardTitle>
              {isEditMode && (
                <CardDescription className="text-xs">Leave API key blank to keep the existing key.</CardDescription>
              )}
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Label</Label>
                    <Input
                      placeholder="e.g. My Anthropic Key"
                      value={form.label}
                      onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Provider</Label>
                    <select
                      className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                      value={form.kind}
                      onChange={e => handleKindChange(e.target.value as ProviderKind)}
                    >
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic</option>
                      <option value="openai_compatible">OpenAI-Compatible (Groq, Mistral, etc.)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Model ID</Label>
                    <Input
                      placeholder={DEFAULT_MODELS[form.kind]}
                      value={form.modelId}
                      onChange={e => setForm(f => ({ ...f, modelId: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>API Key{isEditMode && <span className="ml-1 text-muted-foreground font-normal">(leave blank to keep current)</span>}</Label>
                    <Input
                      type="password"
                      placeholder={isEditMode ? '••••••••' : 'sk-…'}
                      value={form.apiKey}
                      onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))}
                      required={!isEditMode}
                      autoComplete="new-password"
                    />
                  </div>
                </div>

                {form.kind === 'openai_compatible' && (
                  <div className="space-y-1.5">
                    <Label>Base URL</Label>
                    <Input
                      placeholder="https://api.groq.com/openai/v1"
                      value={form.baseUrl}
                      onChange={e => setForm(f => ({ ...f, baseUrl: e.target.value }))}
                      required
                    />
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="isDefault"
                    checked={form.isDefault}
                    onChange={e => setForm(f => ({ ...f, isDefault: e.target.checked }))}
                    className="h-4 w-4 rounded border-input"
                  />
                  <Label htmlFor="isDefault" className="font-normal cursor-pointer">
                    Set as default provider for this workspace
                  </Label>
                </div>

                <div className="flex gap-2 pt-2">
                  <Button type="submit" disabled={saving}>
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {isEditMode ? 'Update Provider' : 'Save Provider'}
                  </Button>
                  <Button type="button" variant="ghost" onClick={closeForm}>Cancel</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {!isFormOpen && (
          <Button variant="outline" onClick={openAdd} className="gap-2">
            <Plus className="h-4 w-4" /> Add Provider
          </Button>
        )}
      </div>
    </div>
  )
}
