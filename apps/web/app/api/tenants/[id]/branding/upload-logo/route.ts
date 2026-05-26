import { NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/auth/route-handler'
import { uploadFile } from '@vibesboard/adapter-s3'

export const runtime = 'nodejs'

const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB
const ACCEPTED_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp'
])

type RouteParams = {
  params: Promise<{ id: string }>
}

/**
 * POST /api/tenants/[id]/branding/upload-logo
 * Upload a logo file to S3. Returns a proxy URL served by our own API.
 */
export async function POST(req: Request, { params }: RouteParams) {
  const { id: tenantId } = await params

  const auth = await requireTenantAdmin(tenantId)
  if (!auth.ok) return auth.response

  const formData = await req.formData()
  const file = formData.get('file') as File | null

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  if (!ACCEPTED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: 'Unsupported file type. Use PNG, JPEG, GIF, or WebP.' },
      { status: 400 }
    )
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: 'File too large. Maximum size is 2MB.' },
      { status: 400 }
    )
  }

  try {
    const key = `branding/${tenantId}/logo`
    const buffer = Buffer.from(await file.arrayBuffer())

    await uploadFile(key, buffer, file.type, {
      cacheControl: 'public, max-age=3600',
    })

    // Return our own proxy URL — cache-bust with timestamp
    const logoUrl = `/api/tenants/${tenantId}/branding/logo?v=${Date.now()}`

    return NextResponse.json({ logoUrl })
  } catch (error: any) {
    console.error('Logo upload error:', error)
    return NextResponse.json(
      { error: 'Failed to upload logo' },
      { status: 500 }
    )
  }
}
