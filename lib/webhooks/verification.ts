import crypto from 'crypto'

/**
 * Verify webhook signature using HMAC-SHA256
 * @param payload - The raw request body as string
 * @param signature - The signature from webhook header (format: sha256=...)
 * @param secret - The webhook secret key
 * @returns true if signature is valid, false otherwise
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  try {
    // Extract the algorithm and hash from signature header
    const [algorithm, hash] = signature.split('=')

    if (algorithm !== 'sha256') {
      console.warn(`Unsupported signature algorithm: ${algorithm}`)
      return false
    }

    // Generate HMAC-SHA256 hash of the payload
    const expectedHash = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex')

    // Compare signatures using constant-time comparison to prevent timing attacks
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expectedHash))
  } catch (error) {
    console.error('Error verifying webhook signature:', error)
    return false
  }
}

/**
 * Verify webhook token (simple token verification for GET requests)
 * @param receivedToken - Token from query parameters
 * @param expectedToken - Token from environment variable
 * @returns true if tokens match, false otherwise
 */
export function verifyWebhookToken(
  receivedToken: string,
  expectedToken: string | undefined
): boolean {
  if (!expectedToken) {
    console.error('Webhook verification token not configured')
    return false
  }

  // Check if lengths match first (constant-time comparison requires same length)
  if (receivedToken.length !== expectedToken.length) {
    return false
  }

  // Use constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(receivedToken),
      Buffer.from(expectedToken)
    )
  } catch (error) {
    console.error('Error during token comparison:', error)
    return false
  }
}

/**
 * Verify webhook request using both signature and token
 * @param payload - The raw request body
 * @param headers - Request headers
 * @param secret - Webhook secret
 * @returns { valid: boolean; error?: string }
 */
export function verifyWebhookRequest(
  payload: string,
  headers: Record<string, string | string[] | undefined>,
  secret: string
): { valid: boolean; error?: string } {
  const signature = headers['x-hub-signature-256'] as string | undefined
  const timestamp = headers['x-hub-timestamp'] as string | undefined

  if (!signature) {
    return {
      valid: false,
      error: 'Missing signature header (x-hub-signature-256)'
    }
  }

  if (!timestamp) {
    return { valid: false, error: 'Missing timestamp header (x-hub-timestamp)' }
  }

  // Verify timestamp (prevent replay attacks - allow 5 minute window)
  const requestTime = parseInt(timestamp, 10)
  const currentTime = Math.floor(Date.now() / 1000)
  const timeDiff = Math.abs(currentTime - requestTime)

  if (timeDiff > 300) {
    // 5 minutes
    return {
      valid: false,
      error: `Request timestamp too old (${timeDiff}s difference)`
    }
  }

  // Verify signature
  const isValid = verifyWebhookSignature(payload, signature, secret)

  if (!isValid) {
    return { valid: false, error: 'Invalid webhook signature' }
  }

  return { valid: true }
}
