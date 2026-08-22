import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import {
  createDeletionRequest,
  updateDeletionRequest,
  deleteInstagramDataForMetaUser
} from '@vibesboard/channel-instagram/data-deletion'
import { getCanonicalOrigin } from '@/lib/app-url'

export const runtime = 'nodejs'

/**
 * Parse Meta's signed_request parameter.
 * Format: base64url(HMAC-SHA256 signature).base64url(JSON payload)
 */
function parseSignedRequest(
  signedRequest: string,
  appSecret: string
): { user_id: string; issued_at: number } | null {
  try {
    const [encodedSig, encodedPayload] = signedRequest.split('.')
    if (!encodedSig || !encodedPayload) return null

    // Decode base64url → base64 → buffer
    const sig = Buffer.from(
      encodedSig.replace(/-/g, '+').replace(/_/g, '/'),
      'base64'
    )
    const payload = Buffer.from(
      encodedPayload.replace(/-/g, '+').replace(/_/g, '/'),
      'base64'
    )

    // Verify HMAC-SHA256 signature
    const expectedSig = crypto
      .createHmac('sha256', appSecret)
      .update(encodedPayload)
      .digest()

    if (
      sig.length !== expectedSig.length ||
      !crypto.timingSafeEqual(sig, expectedSig)
    ) {
      console.error('[Data Deletion] Invalid signed_request signature')
      return null
    }

    return JSON.parse(payload.toString('utf-8'))
  } catch (error) {
    console.error('[Data Deletion] Failed to parse signed request', {
      error: error instanceof Error ? error.name : 'UnknownError'
    })
    return null
  }
}

/**
 * POST — Meta Data Deletion Callback
 *
 * When a user requests deletion of their data via Facebook,
 * Meta sends a signed_request to this endpoint. We:
 * 1. Verify the signature using META_APP_SECRET
 * 2. Find and delete all Instagram inbox data linked to this Meta user
 * 3. Store a deletion request record for status tracking
 * 4. Return a confirmation code and status URL
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const signedRequest = formData.get('signed_request') as string

    if (!signedRequest) {
      return NextResponse.json(
        { error: 'Missing signed_request' },
        { status: 400 }
      )
    }

    const appSecret = process.env.META_APP_SECRET
    if (!appSecret) {
      console.error('[Data Deletion] META_APP_SECRET not configured')
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      )
    }

    const data = parseSignedRequest(signedRequest, appSecret)
    if (!data) {
      return NextResponse.json(
        { error: 'Invalid signed_request' },
        { status: 403 }
      )
    }

    const { user_id: metaUserId } = data
    const confirmationCode = crypto.randomBytes(16).toString('hex')

    // Store the deletion request for status tracking
    await createDeletionRequest(confirmationCode, metaUserId)

    // Complete deletion before acknowledging the callback. Cloud Run may stop
    // the instance as soon as the response is sent, so an unawaited promise is
    // not a durable job queue and can leave the request pending forever.
    await deleteUserData(metaUserId, confirmationCode).catch(error => {
      console.error('[Data Deletion] Deletion failed', {
        name: error instanceof Error ? error.name : 'UnknownError'
      })
    })

    // Build status URL
    const fallbackOrigin = process.env.NEXTAUTH_URL
      ? new URL(process.env.NEXTAUTH_URL).origin
      : new URL(request.url).origin
    const baseUrl = getCanonicalOrigin(fallbackOrigin)

    const statusUrl = `${baseUrl}/deletion-status?id=${confirmationCode}`

    return NextResponse.json({
      url: statusUrl,
      confirmation_code: confirmationCode
    })
  } catch (error: unknown) {
    console.error('[Data Deletion] Request failed', {
      name: error instanceof Error ? error.name : 'UnknownError'
    })
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Find all Instagram inbox accounts connected by this Meta user and delete their
 * data (conversations + messages cascade via FK). Updates the deletion request
 * status when complete.
 */
async function deleteUserData(
  metaUserId: string,
  confirmationCode: string
): Promise<void> {
  try {
    const deletedCount = await deleteInstagramDataForMetaUser(metaUserId)

    await updateDeletionRequest(confirmationCode, {
      status: 'completed',
      deletedAccounts: deletedCount,
      completedAt: new Date()
    })

    console.log('[Data Deletion] Completed', { deletedAccounts: deletedCount })
  } catch (error) {
    // Mark as failed
    await updateDeletionRequest(confirmationCode, {
      status: 'failed',
      error: 'Deletion failed; retry required.'
    })
    throw error
  }
}
