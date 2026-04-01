'use client'

import * as React from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Upload, X, Link as LinkIcon, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'

interface LogoUploadProps {
  value: string
  onChange: (url: string) => void
  /** Tenant ID for the upload endpoint. If omitted (platform branding), uses URL-only mode. */
  tenantId?: string
  disabled?: boolean
}

export function LogoUpload({ value, onChange, tenantId, disabled }: LogoUploadProps) {
  const [isUploading, setIsUploading] = React.useState(false)
  const [mode, setMode] = React.useState<'upload' | 'url'>(value && !value.includes('storage.googleapis.com') ? 'url' : 'upload')
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Client-side validation
    const accepted = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']
    if (!accepted.includes(file.type)) {
      toast.error('Use PNG, JPEG, GIF, WebP, or SVG')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('File too large. Maximum 2MB.')
      return
    }

    if (!tenantId) {
      toast.error('Upload not available — use a URL instead')
      return
    }

    setIsUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch(`/api/tenants/${tenantId}/branding/upload-logo`, {
        method: 'POST',
        body: formData
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Upload failed')
      }

      const data = await res.json()
      onChange(data.logoUrl)
      toast.success('Logo uploaded')
    } catch (err: any) {
      toast.error(err.message || 'Upload failed')
    } finally {
      setIsUploading(false)
      // Reset file input so re-selecting the same file triggers onChange
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleRemove = () => {
    onChange('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Label>Logo</Label>
        {tenantId && (
          <div className="flex gap-1 rounded-md border p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setMode('upload')}
              className={`rounded px-2 py-0.5 transition-colors ${mode === 'upload' ? 'bg-accent-orange/10 text-accent-orange' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Upload className="mr-1 inline size-3" />
              Upload
            </button>
            <button
              type="button"
              onClick={() => setMode('url')}
              className={`rounded px-2 py-0.5 transition-colors ${mode === 'url' ? 'bg-accent-orange/10 text-accent-orange' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <LinkIcon className="mr-1 inline size-3" />
              URL
            </button>
          </div>
        )}
      </div>

      {mode === 'upload' && tenantId ? (
        <div className="space-y-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
            onChange={handleFileSelect}
            className="hidden"
            disabled={disabled || isUploading}
          />
          {value ? (
            <div className="flex items-center gap-3 rounded-lg border p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={value}
                alt="Logo"
                className="h-12 w-auto max-w-[120px] object-contain"
                onError={(e) => { e.currentTarget.style.display = 'none' }}
              />
              <div className="flex flex-1 items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={disabled || isUploading}
                >
                  {isUploading ? (
                    <><Loader2 className="mr-1 size-3 animate-spin" /> Uploading...</>
                  ) : (
                    'Change'
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleRemove}
                  disabled={disabled || isUploading}
                >
                  <X className="size-3" />
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || isUploading}
              className="flex w-full cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border p-6 transition-colors hover:border-accent-orange/50 hover:bg-accent-orange/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isUploading ? (
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              ) : (
                <Upload className="size-6 text-muted-foreground" />
              )}
              <span className="text-sm text-muted-foreground">
                {isUploading ? 'Uploading...' : 'Click to upload logo (PNG, JPEG, SVG — max 2MB)'}
              </span>
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <Input
            placeholder="https://example.com/logo.png"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
          />
          {value && (
            <div className="rounded-lg border p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={value}
                alt="Logo preview"
                className="h-12 object-contain"
                onError={(e) => { e.currentTarget.style.display = 'none' }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
