import { NextResponse } from 'next/server'
import { bucket } from '@vibesboard/adapter-firebase/storage'

export const runtime = 'nodejs'

type RouteParams = {
  params: Promise<{ id: string }>
}

/**
 * GET /api/tenants/[id]/branding/logo
 * Serves the tenant logo image from GCS. No auth required — logos are public assets.
 */
export async function GET(req: Request, { params }: RouteParams) {
  const { id: tenantId } = await params

  const key = `branding/${tenantId}/logo`
  const file = bucket.file(key)

  const [exists] = await file.exists()
  if (!exists) {
    return new NextResponse(null, {
      status: 404,
      headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' }
    })
  }

  const [buffer] = await file.download()
  const [metadata] = await file.getMetadata()
  const contentType = metadata.contentType || 'image/png'

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600, s-maxage=86400'
    }
  })
}
