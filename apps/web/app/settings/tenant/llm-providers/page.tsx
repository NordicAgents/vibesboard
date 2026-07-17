'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import toast from 'react-hot-toast'
import { Plus, Trash2, Loader2, Star, Pencil, Shield, X } from 'lucide-react'

type ProviderKind = 'openai' | 'anthropic' | 'openai_compatible' | 'google' | 'nvidia'

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
  google: 'Google Gemini',
  nvidia: 'NVIDIA',
}

const KIND_COLORS: Record<ProviderKind, string> = {
  openai:           'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/40',
  anthropic:        'bg-orange-100  text-orange-700  ring-1 ring-orange-300  dark:bg-orange-500/15  dark:text-orange-300  dark:ring-orange-500/40',
  openai_compatible:'bg-sky-100     text-sky-700     ring-1 ring-sky-300     dark:bg-sky-500/15     dark:text-sky-300     dark:ring-sky-500/40',
  google:           'bg-purple-100  text-purple-700  ring-1 ring-purple-300  dark:bg-purple-500/15  dark:text-purple-300  dark:ring-purple-500/40',
  nvidia:           'bg-lime-100    text-lime-700    ring-1 ring-lime-300    dark:bg-lime-500/15    dark:text-lime-300    dark:ring-lime-500/40',
}

const DEFAULT_MODELS: Record<ProviderKind, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-5',
  openai_compatible: 'llama-3.3-70b-versatile',
  google: 'gemini-2.5-flash',
  nvidia: 'meta/llama-3.1-70b-instruct',
}

// Official model lists per provider (latest as of 2026-07)
const PROVIDER_MODELS: Partial<Record<ProviderKind, Array<{ id: string; label: string; recommended?: boolean }>>> = {
  openai: [
    { id: 'gpt-5.6-sol',   label: 'GPT-5.6 Sol',        recommended: true },
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
    { id: 'gpt-5.6-luna',  label: 'GPT-5.6 Luna' },
    { id: 'gpt-4o',        label: 'GPT-4o' },
    { id: 'gpt-4o-mini',   label: 'GPT-4o Mini' },
    { id: 'o3',            label: 'o3' },
    { id: 'o3-mini',       label: 'o3 Mini' },
  ],
  anthropic: [
    { id: 'claude-fable-5',            label: 'Claude Fable 5',   recommended: true },
    { id: 'claude-opus-4-8',           label: 'Claude Opus 4.8' },
    { id: 'claude-sonnet-5',           label: 'Claude Sonnet 5' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  ],
  google: [
    // Non-thinking models — work with current SDK
    { id: 'gemini-2.0-flash',        label: 'Gemini 2.0 Flash ✓',    recommended: true },
    { id: 'gemini-1.5-flash',        label: 'Gemini 1.5 Flash ✓' },
    { id: 'gemini-1.5-pro',          label: 'Gemini 1.5 Pro ✓' },
    // Thinking models — require SDK upgrade (may return empty responses)
    { id: 'gemini-2.5-flash',        label: 'Gemini 2.5 Flash (thinking)' },
    { id: 'gemini-2.5-pro',          label: 'Gemini 2.5 Pro (thinking)' },
    { id: 'gemini-3.5-flash',        label: 'Gemini 3.5 Flash (thinking)' },
  ],
  nvidia: [
    // Hosted on NVIDIA's API catalog (build.nvidia.com) — free tier, nvapi- key
    { id: 'meta/llama-3.1-70b-instruct',          label: 'Llama 3.1 70B Instruct', recommended: true },
    { id: 'meta/llama-3.3-70b-instruct',          label: 'Llama 3.3 70B Instruct' },
    { id: 'meta/llama-3.1-8b-instruct',           label: 'Llama 3.1 8B Instruct' },
    { id: 'nvidia/llama-3.1-nemotron-70b-instruct', label: 'Nemotron 70B Instruct' },
    { id: 'nvidia/nemotron-3-ultra-550b-a55b',    label: 'Nemotron 3 Ultra 550B' },
    { id: 'deepseek-ai/deepseek-v4-pro',          label: 'DeepSeek V4 Pro' },
    { id: 'qwen/qwen3-coder-480b-a35b-instruct',  label: 'Qwen3 Coder 480B' },
    { id: 'mistralai/mixtral-8x22b-instruct',     label: 'Mixtral 8x22B Instruct' },
  ],
  // openai_compatible intentionally omitted — free text (varies by provider)
}

type LlmTask = 'chat' | 'embed' | 'agent_creator' | '*'

const TASK_LABELS: Record<LlmTask, { label: string; description: string }> = {
  chat:          { label: 'Chat',          description: 'Agent conversations with users' },
  embed:         { label: 'Embeddings',    description: 'File indexing and RAG search' },
  agent_creator: { label: 'Agent Builder', description: 'The AI that helps you create agents' },
  '*':           { label: 'Default',       description: 'All other tasks (wildcard)' },
}

interface TaskAssignment {
  task: LlmTask
  configId: string
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
  const [taskAssignments, setTaskAssignments] = useState<TaskAssignment[]>([])
  const [allowPrivateHosts, setAllowPrivateHosts] = useState(false)
  const [hostAllowlist, setHostAllowlist] = useState<string[]>([])
  const [newAllowlistEntry, setNewAllowlistEntry] = useState('')
  const [savingNetwork, setSavingNetwork] = useState(false)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<Mode>({ type: 'idle' })
  const [form, setForm] = useState<FormState>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [savingTask, setSavingTask] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [cfgRes, taskRes, netRes] = await Promise.all([
        fetch('/api/tenants/llm-configs'),
        fetch('/api/tenants/llm-configs/tasks'),
        fetch('/api/tenants/llm-configs/network'),
      ])
      if (!cfgRes.ok) throw new Error('Failed to load')
      setConfigs((await cfgRes.json()).configs)
      if (taskRes.ok) setTaskAssignments((await taskRes.json()).assignments ?? [])
      if (netRes.ok) {
        const net = await netRes.json()
        setAllowPrivateHosts(net.llmAllowPrivateHosts ?? false)
        setHostAllowlist(net.llmHostAllowlist ?? [])
      }
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
    // pre-select the recommended model for the new provider, or the default
    const recommended = PROVIDER_MODELS[kind]?.find(m => m.recommended)
    setForm(f => ({ ...f, kind, modelId: recommended?.id ?? DEFAULT_MODELS[kind] }))
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

  const saveNetworkSettings = async (patch: { llmAllowPrivateHosts?: boolean; llmHostAllowlist?: string[] }) => {
    setSavingNetwork(true)
    try {
      const res = await fetch('/api/tenants/llm-configs/network', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error()
      if (patch.llmAllowPrivateHosts !== undefined) setAllowPrivateHosts(patch.llmAllowPrivateHosts)
      if (patch.llmHostAllowlist !== undefined) setHostAllowlist(patch.llmHostAllowlist)
      toast.success('Network settings saved')
    } catch {
      toast.error('Failed to save network settings')
    } finally {
      setSavingNetwork(false)
    }
  }

  const addAllowlistEntry = () => {
    const host = newAllowlistEntry.trim().toLowerCase()
    if (!host || hostAllowlist.includes(host)) return
    const updated = [...hostAllowlist, host]
    setNewAllowlistEntry('')
    saveNetworkSettings({ llmHostAllowlist: updated })
  }

  const removeAllowlistEntry = (host: string) => {
    saveNetworkSettings({ llmHostAllowlist: hostAllowlist.filter(h => h !== host) })
  }

  const handleTaskAssign = async (task: LlmTask, configId: string | null) => {
    setSavingTask(task)
    try {
      const res = await fetch('/api/tenants/llm-configs/tasks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, configId }),
      })
      if (!res.ok) throw new Error()
      await load()
    } catch {
      toast.error('Failed to update task assignment')
    } finally {
      setSavingTask(null)
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
                      <option value="google">Google Gemini</option>
                      <option value="nvidia">NVIDIA (build.nvidia.com — free tier)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Model</Label>
                    {PROVIDER_MODELS[form.kind] ? (
                      <>
                        <select
                          className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                          value={PROVIDER_MODELS[form.kind]!.some(m => m.id === form.modelId) ? form.modelId : '__custom__'}
                          onChange={e => {
                            if (e.target.value !== '__custom__') {
                              setForm(f => ({ ...f, modelId: e.target.value }))
                            }
                          }}
                          required
                        >
                          {PROVIDER_MODELS[form.kind]!.map(m => (
                            <option key={m.id} value={m.id}>
                              {m.label}{m.recommended ? ' ★' : ''}
                            </option>
                          ))}
                          <option value="__custom__">Custom model ID…</option>
                        </select>
                        {/* show text input when "Custom" is selected */}
                        {!PROVIDER_MODELS[form.kind]!.some(m => m.id === form.modelId) && (
                          <Input
                            placeholder="Enter model ID"
                            value={form.modelId}
                            onChange={e => setForm(f => ({ ...f, modelId: e.target.value }))}
                            required
                            className="mt-1"
                          />
                        )}
                      </>
                    ) : (
                      <Input
                        placeholder={DEFAULT_MODELS[form.kind]}
                        value={form.modelId}
                        onChange={e => setForm(f => ({ ...f, modelId: e.target.value }))}
                        required
                      />
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>API Key{isEditMode && <span className="ml-1 text-muted-foreground font-normal">(leave blank to keep current)</span>}</Label>
                    <Input
                      type="password"
                      placeholder={isEditMode ? '••••••••' : form.kind === 'nvidia' ? 'nvapi-…' : 'sk-…'}
                      value={form.apiKey}
                      onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))}
                      required={!isEditMode}
                      autoComplete="new-password"
                    />
                  </div>
                </div>

                {form.kind === 'nvidia' && (
                  <p className="text-xs text-muted-foreground">
                    Get a free API key at{' '}
                    <a href="https://build.nvidia.com" target="_blank" rel="noreferrer" className="underline">
                      build.nvidia.com
                    </a>
                    {' '}— the free tier gives rate-limited access to 100+ hosted models
                    (no credit card). Requests go to integrate.api.nvidia.com.
                  </p>
                )}

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

        {/* ── Per-task assignment matrix ── */}
        {configs.length > 0 && !isFormOpen && (
          <div className="mt-6 space-y-3">
            <div>
              <h3 className="text-sm font-medium">Task Routing</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Assign a specific provider to each task. Unassigned tasks use the Default provider.
              </p>
            </div>
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground w-1/3">Task</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Provider</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(['chat', 'embed', 'agent_creator', '*'] as LlmTask[]).map(task => {
                    const assigned = taskAssignments.find(a => a.task === task)?.configId ?? null
                    const taskMeta = TASK_LABELS[task]
                    return (
                      <tr key={task} className="bg-background">
                        <td className="px-4 py-3">
                          <div className="font-medium">{taskMeta.label}</div>
                          <div className="text-xs text-muted-foreground">{taskMeta.description}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <select
                              className="h-8 rounded-md border border-input bg-background px-2 text-sm flex-1 max-w-xs"
                              value={assigned ?? ''}
                              disabled={savingTask === task}
                              onChange={e => handleTaskAssign(task, e.target.value || null)}
                            >
                              <option value="">— Use default resolution —</option>
                              {configs.filter(c => c.isEnabled).map(c => (
                                <option key={c.id} value={c.id}>
                                  {c.label} ({KIND_LABELS[c.kind]} · {c.modelId})
                                </option>
                              ))}
                            </select>
                            {savingTask === task && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Network Access ── */}
        {!isFormOpen && (
          <Card className="mt-2">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base">Network Access</CardTitle>
              </div>
              <CardDescription className="text-xs">
                Configure which hosts the server can reach for local or private LLM deployments (e.g. Ollama on your network).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Allow private hosts toggle */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Allow private / local hosts</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Permits base URLs with private IP ranges (10.x, 192.168.x, localhost, etc.).
                    Use for on-device or LAN-deployed models.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={allowPrivateHosts}
                  disabled={savingNetwork}
                  onClick={() => saveNetworkSettings({ llmAllowPrivateHosts: !allowPrivateHosts })}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors focus-visible:outline-none disabled:opacity-50 ${
                    allowPrivateHosts ? 'bg-primary' : 'bg-input'
                  }`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg transition-transform mt-0.5 ${allowPrivateHosts ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>

              {/* Allowlist */}
              <div className="space-y-2">
                <p className="text-sm font-medium">Host allowlist</p>
                <p className="text-xs text-muted-foreground">
                  Specific hostnames always permitted regardless of the toggle above (e.g. <code className="text-xs">gpu-box.internal</code>, <code className="text-xs">192.168.1.50</code>).
                </p>
                <div className="flex flex-wrap gap-1.5 min-h-[28px]">
                  {hostAllowlist.map(host => (
                    <span key={host} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-mono">
                      {host}
                      <button
                        type="button"
                        onClick={() => removeAllowlistEntry(host)}
                        disabled={savingNetwork}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  {hostAllowlist.length === 0 && (
                    <span className="text-xs text-muted-foreground italic">No hosts allowlisted</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="hostname or IP (e.g. 192.168.1.50)"
                    value={newAllowlistEntry}
                    onChange={e => setNewAllowlistEntry(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addAllowlistEntry())}
                    className="h-8 text-sm font-mono flex-1"
                  />
                  <Button size="sm" variant="outline" onClick={addAllowlistEntry} disabled={savingNetwork || !newAllowlistEntry.trim()}>
                    Add
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {!isFormOpen && (
          <Button variant="outline" onClick={openAdd} className="gap-2 mt-2">
            <Plus className="h-4 w-4" /> Add Provider
          </Button>
        )}
      </div>
    </div>
  )
}
