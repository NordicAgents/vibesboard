'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Copy,
  Trash2,
  Plus,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  Link
} from 'lucide-react'
import type { InviteCodeDocument } from '@/lib/firestore-types'

interface InviteCodeManagerProps {
  agentId: string
  tenantSlug: string
  agentUrl: string
  hasPassword: boolean
  disabled?: boolean
}

function codeStatus(
  code: InviteCodeDocument
): 'active' | 'expired' | 'revoked' | 'exhausted' {
  if (code.revoked) return 'revoked'
  if (code.expiresAt && new Date(code.expiresAt) < new Date()) return 'expired'
  if (code.maxUses !== null && code.usedCount >= code.maxUses)
    return 'exhausted'
  return 'active'
}

const statusColors: Record<string, string> = {
  active:
    'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  expired:
    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  revoked: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  exhausted: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400'
}

export function InviteCodeManager({
  agentId,
  tenantSlug,
  agentUrl,
  hasPassword: initialHasPassword,
  disabled
}: InviteCodeManagerProps) {
  // ─── Password state ───
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [hasPassword, setHasPassword] = useState(initialHasPassword)
  const [savingPassword, setSavingPassword] = useState(false)

  // ─── Invite code state ───
  const [codes, setCodes] = useState<InviteCodeDocument[]>([])
  const [loadingCodes, setLoadingCodes] = useState(true)
  const [customCode, setCustomCode] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [maxUses, setMaxUses] = useState('')
  const [creating, setCreating] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const fetchCodes = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/${agentId}/invite-codes`)
      if (res.ok) setCodes(await res.json())
    } finally {
      setLoadingCodes(false)
    }
  }, [agentId])

  useEffect(() => {
    fetchCodes()
  }, [fetchCodes])

  // ─── Password handlers ───
  async function savePassword() {
    setSavingPassword(true)
    try {
      await fetch(`/api/agents/${agentId}/access-password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      })
      setHasPassword(true)
      setPassword('')
    } finally {
      setSavingPassword(false)
    }
  }

  async function removePassword() {
    setSavingPassword(true)
    try {
      await fetch(`/api/agents/${agentId}/access-password`, {
        method: 'DELETE'
      })
      setHasPassword(false)
    } finally {
      setSavingPassword(false)
    }
  }

  // ─── Invite code handlers ───
  async function generateCode() {
    setCreating(true)
    try {
      const res = await fetch(`/api/agents/${agentId}/invite-codes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: customCode || undefined,
          expiresAt: expiresAt || null,
          maxUses: maxUses ? parseInt(maxUses, 10) : null
        })
      })
      if (res.ok) {
        setCustomCode('')
        setExpiresAt('')
        setMaxUses('')
        fetchCodes()
      }
    } finally {
      setCreating(false)
    }
  }

  async function revoke(codeId: string) {
    await fetch(`/api/agents/${agentId}/invite-codes/${codeId}`, {
      method: 'PATCH'
    })
    fetchCodes()
  }

  function copyText(text: string, id: string) {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  function inviteLink(code: string) {
    return `${window.location.origin}/${tenantSlug}/${agentUrl}?code=${code}`
  }

  return (
    <div className="space-y-4">
      {/* Password section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Access Password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Anyone with this password can access the agent.
          </p>
          {hasPassword ? (
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">
                Password set
              </Badge>
              <Button
                size="sm"
                variant="ghost"
                onClick={removePassword}
                disabled={disabled || savingPassword}
                className="text-red-600 hover:text-red-700"
              >
                <Trash2 className="mr-1 h-3 w-3" /> Remove
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Set a password"
                  disabled={disabled || savingPassword}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              <Button
                size="sm"
                onClick={savePassword}
                disabled={disabled || savingPassword || !password.trim()}
              >
                Save
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Invite codes section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Invite Codes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Generate form */}
          <div className="space-y-2 rounded-md border p-3">
            <div className="flex gap-2">
              <Input
                value={customCode}
                onChange={e => setCustomCode(e.target.value)}
                placeholder="Custom code (optional)"
                disabled={disabled || creating}
                className="flex-1"
              />
              <Button
                size="sm"
                onClick={generateCode}
                disabled={disabled || creating}
              >
                <Plus className="mr-1 h-3 w-3" /> Generate
              </Button>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground">Expires</label>
                <Input
                  type="datetime-local"
                  value={expiresAt}
                  onChange={e => setExpiresAt(e.target.value)}
                  disabled={disabled || creating}
                  className="mt-1"
                />
              </div>
              <div className="w-24">
                <label className="text-xs text-muted-foreground">
                  Max uses
                </label>
                <Input
                  type="number"
                  min={1}
                  value={maxUses}
                  onChange={e => setMaxUses(e.target.value)}
                  placeholder="∞"
                  disabled={disabled || creating}
                  className="mt-1"
                />
              </div>
            </div>
          </div>

          {/* Code list */}
          {loadingCodes ? (
            <p className="text-xs text-muted-foreground">Loading...</p>
          ) : codes.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No invite codes yet. Generate one to share gated access.
            </p>
          ) : (
            <div className="space-y-2">
              {codes.map(code => {
                const status = codeStatus(code)
                const isExpanded = expandedId === code.id
                return (
                  <div key={code.id} className="rounded-md border p-3">
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-medium">{code.code}</code>
                      <Badge className={`text-xs ${statusColors[status]}`}>
                        {status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {code.usedCount}
                        {code.maxUses !== null ? `/${code.maxUses}` : ''} uses
                      </span>
                      <span className="flex-1" />
                      <button
                        onClick={() => copyText(code.code, `code-${code.id}`)}
                        className="text-muted-foreground hover:text-foreground"
                        title="Copy code"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() =>
                          copyText(inviteLink(code.code), `link-${code.id}`)
                        }
                        className="text-muted-foreground hover:text-foreground"
                        title="Copy invite link"
                      >
                        <Link className="h-3.5 w-3.5" />
                      </button>
                      {status === 'active' && (
                        <button
                          onClick={() => revoke(code.id)}
                          className="text-red-500 hover:text-red-700"
                          title="Revoke"
                          disabled={disabled}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {code.redemptions.length > 0 && (
                        <button
                          onClick={() =>
                            setExpandedId(isExpanded ? null : code.id)
                          }
                          className="text-muted-foreground hover:text-foreground"
                        >
                          {isExpanded ? (
                            <ChevronUp className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                          )}
                        </button>
                      )}
                    </div>
                    {copied === `code-${code.id}` && (
                      <span className="text-xs text-green-600">Copied!</span>
                    )}
                    {copied === `link-${code.id}` && (
                      <span className="text-xs text-green-600">
                        Link copied!
                      </span>
                    )}
                    <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
                      {code.expiresAt && (
                        <span>
                          Expires:{' '}
                          {new Date(code.expiresAt).toLocaleDateString()}
                        </span>
                      )}
                      <span>
                        Created: {new Date(code.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    {isExpanded && code.redemptions.length > 0 && (
                      <div className="mt-2 border-t pt-2">
                        <p className="mb-1 text-xs font-medium text-muted-foreground">
                          Redemptions
                        </p>
                        {code.redemptions.map((r, i) => (
                          <div
                            key={i}
                            className="flex justify-between text-xs text-muted-foreground"
                          >
                            <span className="font-mono">
                              {r.externalId.slice(0, 8)}...
                            </span>
                            <span>
                              {new Date(r.redeemedAt).toLocaleString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
