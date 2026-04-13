import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'

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
    console.error('[Data Deletion] Failed to parse signed_request:', error)
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
    await adminDb
      .collection('meta_data_deletion_requests')
      .doc(confirmationCode)
      .set({
        confirmationCode,
        metaUserId,
        status: 'pending',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      })

    // Find and delete Instagram inbox data for this Meta user asynchronously
    deleteUserData(metaUserId, confirmationCode).catch(err => {
      console.error('[Data Deletion] Background deletion failed:', err)
    })

    // Build status URL
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXTAUTH_URL ||
      `https://${request.headers.get('host')}`

    const statusUrl = `${baseUrl}/deletion-status?id=${confirmationCode}`

    return NextResponse.json({
      url: statusUrl,
      confirmation_code: confirmationCode
    })
  } catch (error: any) {
    console.error('[Data Deletion] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Find all Instagram inbox accounts connected by this Meta user and delete their data.
 * Updates the deletion request status when complete.
 */
async function deleteUserData(
  metaUserId: string,
  confirmationCode: string
): Promise<void> {
  const BATCH_SIZE = 500

  try {
    // Find Instagram inbox accounts where metaUserId matches the Facebook
    // app-scoped user ID from Meta's signed_request.
    const accountsSnap = await adminDb
      .collectionGroup('instagram_inbox_accounts')
      .where('metaUserId', '==', metaUserId)
      .get()

    let deletedCount = 0

    for (const accountDoc of accountsSnap.docs) {
      const accountPath = accountDoc.ref.path
      // Path: tenants/{tenantId}/instagram_inbox_accounts/{accountId}
      const pathParts = accountPath.split('/')
      const tenantId = pathParts[1]
      const accountId = accountDoc.id

      // Delete all messages in all conversations
      const conversationsSnap = await adminDb
        .collection(
          `tenants/${tenantId}/instagram_inbox_accounts/${accountId}/conversations`
        )
        .get()

      for (const convDoc of conversationsSnap.docs) {
        const messagesSnap = await adminDb
          .collection(
            `tenants/${tenantId}/instagram_inbox_accounts/${accountId}/conversations/${convDoc.id}/messages`
          )
          .get()

        // Chunk deletes to respect Firestore's 500-operation batch limit
        for (let i = 0; i < messagesSnap.docs.length; i += BATCH_SIZE) {
          const chunk = messagesSnap.docs.slice(i, i + BATCH_SIZE)
          const batch = adminDb.batch()
          chunk.forEach((msgDoc: any) => batch.delete(msgDoc.ref))
          await batch.commit()
        }

        // Delete conversation doc
        await convDoc.ref.delete()
      }

      // Delete the account doc
      await accountDoc.ref.delete()
      deletedCount++
    }

    // Update deletion request status
    await adminDb
      .collection('meta_data_deletion_requests')
      .doc(confirmationCode)
      .update({
        status: 'completed',
        deletedAccounts: deletedCount,
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      })

    console.log(
      `[Data Deletion] Completed for Meta user ${metaUserId}: ${deletedCount} account(s) deleted`
    )
  } catch (error) {
    // Mark as failed
    await adminDb
      .collection('meta_data_deletion_requests')
      .doc(confirmationCode)
      .update({
        status: 'failed',
        error: String(error),
        updatedAt: FieldValue.serverTimestamp()
      })
    throw error
  }
}
