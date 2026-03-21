'use client'

import { Copy } from 'lucide-react'
import toast from 'react-hot-toast'

import { Button } from '@/components/ui/button'

export function CopyButton({
  text,
  label = 'Copy'
}: {
  text: string
  label?: string
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          toast.success('Copied')
        } catch {
          toast.error('Failed to copy')
        }
      }}
    >
      <Copy className="mr-2 size-4" />
      {label}
    </Button>
  )
}

