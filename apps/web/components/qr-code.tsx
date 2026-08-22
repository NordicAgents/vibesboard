'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import QRCode from 'qrcode'

interface QrCodeProps {
  value?: string
  dataUrl?: string
  size?: number
}

export function QrCode({ value, dataUrl, size = 200 }: QrCodeProps) {
  const [generated, setGenerated] = useState<string | null>(null)

  // A caller-supplied `dataUrl` wins outright, and a missing `value` means
  // there is nothing to show. Deriving during render keeps both cases out of
  // the effect, which would otherwise setState synchronously on every prop
  // change and force a second render pass.
  const qr = dataUrl ?? (value ? generated : null)

  useEffect(() => {
    if (dataUrl || !value) return

    // Generation is async, so a fast prop change can land an older QR code
    // after a newer one. Ignore results from a superseded run.
    let cancelled = false
    QRCode.toDataURL(value, {
      margin: 1,
      width: size
    }).then(next => {
      if (!cancelled) setGenerated(next)
    })
    return () => {
      cancelled = true
    }
  }, [value, dataUrl, size])

  if (!qr) {
    return (
      <div
        className="flex size-[200px] items-center justify-center rounded-xl border bg-muted"
        aria-busy
      >
        Generating QR...
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-white p-2">
      <Image src={qr} alt="QR code" width={size} height={size} unoptimized />
    </div>
  )
}
