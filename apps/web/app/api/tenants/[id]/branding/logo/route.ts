import { NextResponse } from 'next/server'
import { downloadFile, getFileMetadata } from '@vibesboard/adapter-s3'

export const runtime = 'nodejs'

type RouteParams = {
  params: Promise<{ id: string }>
}

/**
 * GET /api/tenants/[id]/branding/logo
 * Serves the tenant logo image from S3. No auth required — logos are public assets.
 */
export async function GET(req: Request, { params }: RouteParams) {
  const { id: tenantId } = await params

  const key = `branding/${tenantId}/logo`

  const meta = await getFileMetadata(key)
  if (!meta) {
    return new NextResponse(null, {
      status: 404,
      headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' }
    })
  }

  const buffer = await downloadFile(key)
  const contentType = meta.contentType ?? 'image/png'

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600, s-maxage=86400'
    }
  })
}
