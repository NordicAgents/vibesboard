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
  const [qr, setQr] = useState<string | null>(dataUrl ?? null)

  useEffect(() => {
    if (dataUrl) {
      setQr(dataUrl)
      return
    }

    if (!value) {
      setQr(null)
      return
    }

    QRCode.toDataURL(value, {
      margin: 1,
      width: size
    }).then(setQr)
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
