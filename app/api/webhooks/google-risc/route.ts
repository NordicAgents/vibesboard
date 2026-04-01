import { NextResponse } from 'next/server'
import { verifyRiscToken, handleRiscEvents } from '@/lib/google/risc'

/**
 * POST /api/webhooks/google-risc
 *
 * Receives Security Event Tokens (SETs) from Google's Cross-Account
 * Protection (RISC) service. Google sends a JWT in the request body
 * whenever a security event affects one of our users' Google accounts.
 *
 * https://developers.google.com/identity/protocols/risc
 */
export async function POST(request: Request) {
  try {
    const body = await request.text()

    if (!body) {
      return NextResponse.json(
        { error: 'Empty request body' },
        { status: 400 }
      )
    }

    // The body is the raw JWT (Security Event Token)
    const token = body.trim()

    const payload = await verifyRiscToken(token)
    await handleRiscEvents(payload)

    // Google expects 202 Accepted
    return new NextResponse(null, { status: 202 })
  } catch (error: any) {
    console.error('[RISC] Webhook error:', error?.message)
    return NextResponse.json(
      { error: 'Invalid security event token' },
      { status: 400 }
    )
  }
}
