'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'

interface AccessGateFormProps {
  agentId: string
  agentName: string
  logoUrl?: string | null
  embed?: boolean
  onVerified: () => void
}

export function AccessGateForm({
  agentId,
  agentName,
  logoUrl,
  embed,
  onVerified
}: AccessGateFormProps) {
  const searchParams = useSearchParams()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Auto-validate URL code on mount
  useEffect(() => {
    const code = searchParams.get('code')
    if (code) {
      verify(code)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function verify(val: string) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/public/agents/${agentId}/verify-access`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(embed ? { 'x-embed': 'true' } : {})
        },
        body: JSON.stringify({ value: val })
      })
      if (res.ok) {
        onVerified()
        return
      }
      const data = await res.json()
      setError(data.error || 'Access denied')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) return
    verify(trimmed)
  }

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="mx-auto w-full max-w-md rounded-2xl border border-[#e4e3e3] bg-[#f5f8f7] p-8 text-center shadow-[0_4px_24px_rgba(0,0,0,0.08)] dark:border-[#344348] dark:bg-[#192425]">
        {logoUrl && (
          <img
            src={logoUrl}
            alt=""
            className="mx-auto mb-4 h-12 w-12 rounded-full object-cover"
          />
        )}
        <h1 className="font-sans text-2xl font-normal text-[#222f30] dark:text-[#f5f8f7]">
          {agentName}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-[#445e5f] dark:text-[#6f7f80]">
          Enter a password or invite code to continue.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-3">
          <input
            type="text"
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder="Password or invite code"
            disabled={loading}
            autoFocus
            className="w-full rounded-lg border border-[#e4e3e3] bg-white px-4 py-3 text-sm text-[#222f30] placeholder-[#9d9790] outline-none transition-shadow focus:border-[#D97757] focus:ring-2 focus:ring-[#D97757]/20 disabled:opacity-50 dark:border-[#344348] dark:bg-[#1a2526] dark:text-[#f5f8f7] dark:placeholder-[#6f7f80]"
          />
          <button
            type="submit"
            disabled={loading || !value.trim()}
            className="w-full rounded-lg bg-[#D97757] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-[#CC785C] disabled:opacity-50"
          >
            {loading ? 'Verifying...' : 'Continue'}
          </button>
        </form>

        {error && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>
    </div>
  )
}
