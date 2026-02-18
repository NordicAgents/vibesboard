/**
 * WhatsApp Template Message Sender
 *
 * Handles sending template-based messages via Meta WhatsApp Business API:
 * - Build template payload with variables
 * - Send via Meta Graph API
 * - Handle errors and rate limits
 */

// =====================================================
// Types & Interfaces
// =====================================================

export interface SendTemplateMessageParams {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  templateName: string;
  language: string;
  variables?: Record<string, string>;
  headerMedia?: {
    type: 'image' | 'video' | 'document';
    url: string;
  };
}

export interface WhatsAppAPIResponse {
  messages?: Array<{ id: string }>;
  error?: {
    message: string;
    code: number;
    error_data?: any;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

export interface SendResult {
  messageId: string;
  recipientPhone: string;
  timestamp: string;
}

// =====================================================
// Custom Error Class
// =====================================================

export class WhatsAppAPIError extends Error {
  code: number;
  subcode?: number;
  fbtraceId?: string;
  isRateLimit: boolean;
  isInvalidRecipient: boolean;

  constructor(message: string, code: number, subcode?: number, fbtraceId?: string) {
    super(message);
    this.name = 'WhatsAppAPIError';
    this.code = code;
    this.subcode = subcode;
    this.fbtraceId = fbtraceId;

    // Categorize error types
    this.isRateLimit = code === 80007 || code === 130429;
    this.isInvalidRecipient = code === 131026 || code === 131047;
  }
}

// =====================================================
// Helper Functions
// =====================================================

/**
 * Build template components from variables
 */
function buildTemplateComponents(
  variables?: Record<string, string>,
  headerMedia?: { type: string; url: string }
): any[] {
  const components: any[] = [];

  // Header component (if media)
  if (headerMedia) {
    components.push({
      type: 'header',
      parameters: [
        {
          type: headerMedia.type,
          [headerMedia.type]: {
            link: headerMedia.url,
          },
        },
      ],
    });
  }

  // Body component (if variables)
  if (variables && Object.keys(variables).length > 0) {
    components.push({
      type: 'body',
      parameters: Object.values(variables).map(value => ({
        type: 'text',
        text: value,
      })),
    });
  }

  return components;
}

/**
 * Validate phone number format (E.164)
 */
function validatePhoneNumber(phoneNumber: string): boolean {
  // E.164 format: + followed by 1-15 digits
  return /^\+[1-9]\d{7,14}$/.test(phoneNumber);
}

// =====================================================
// Main Sender Function
// =====================================================

/**
 * Send a template message via WhatsApp Business API
 *
 * @throws WhatsAppAPIError if Meta API returns an error
 */
export async function sendTemplateMessage(
  params: SendTemplateMessageParams
): Promise<SendResult> {
  // Validate phone number
  if (!validatePhoneNumber(params.to)) {
    throw new WhatsAppAPIError(
      `Invalid phone number format: ${params.to}. Must be E.164 format (e.g., +1234567890)`,
      131026 // Invalid recipient error code
    );
  }

  const url = `https://graph.facebook.com/v18.0/${params.phoneNumberId}/messages`;

  const payload: any = {
    messaging_product: 'whatsapp',
    to: params.to,
    type: 'template',
    template: {
      name: params.templateName,
      language: { code: params.language },
    },
  };

  // Add components if variables or media provided
  const components = buildTemplateComponents(params.variables, params.headerMedia);
  if (components.length > 0) {
    payload.template.components = components;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data: WhatsAppAPIResponse = await response.json();

  if (!response.ok || data.error) {
    const error = data.error!;
    throw new WhatsAppAPIError(
      error.message || 'Unknown error',
      error.code || 500,
      error.error_subcode,
      error.fbtrace_id
    );
  }

  if (!data.messages || data.messages.length === 0) {
    throw new WhatsAppAPIError(
      'No message ID returned from Meta API',
      500
    );
  }

  return {
    messageId: data.messages[0].id,
    recipientPhone: params.to,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Send template message with retry logic
 * Retries on rate limit errors with exponential backoff
 */
export async function sendTemplateMessageWithRetry(
  params: SendTemplateMessageParams,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<SendResult> {
  let lastError: WhatsAppAPIError | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await sendTemplateMessage(params);
    } catch (error) {
      if (error instanceof WhatsAppAPIError) {
        lastError = error;

        // Don't retry on invalid recipient errors
        if (error.isInvalidRecipient) {
          throw error;
        }

        // Retry on rate limit errors
        if (error.isRateLimit && attempt < maxRetries - 1) {
          const delay = initialDelay * Math.pow(2, attempt);
          console.log(
            `Rate limit hit, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`
          );
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        // Don't retry on other errors
        throw error;
      }

      // Unknown error
      throw error;
    }
  }

  // All retries failed
  throw lastError || new Error('Failed to send message after retries');
}

/**
 * Batch send template messages
 * Sends to multiple recipients with rate limiting
 */
export async function sendTemplateBatch(
  params: Omit<SendTemplateMessageParams, 'to'>,
  recipients: string[],
  rateLimit: number = 20, // messages per second
  onProgress?: (sent: number, total: number, result: SendResult | Error) => void
): Promise<{
  successful: SendResult[];
  failed: Array<{ phone: string; error: Error }>;
}> {
  const successful: SendResult[] = [];
  const failed: Array<{ phone: string; error: Error }> = [];

  const delayMs = 1000 / rateLimit;

  for (let i = 0; i < recipients.length; i++) {
    const recipient = recipients[i];

    try {
      const result = await sendTemplateMessageWithRetry({
        ...params,
        to: recipient,
      });

      successful.push(result);
      onProgress?.(i + 1, recipients.length, result);
    } catch (error) {
      failed.push({
        phone: recipient,
        error: error as Error,
      });
      onProgress?.(i + 1, recipients.length, error as Error);
    }

    // Rate limiting delay (except for last message)
    if (i < recipients.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return { successful, failed };
}

// =====================================================
// Error Code Reference
// =====================================================

/**
 * Common WhatsApp API Error Codes
 *
 * Rate Limiting:
 * - 80007: Rate limit hit
 * - 130429: Rate limit exceeded
 *
 * Invalid Recipient:
 * - 131026: Message undeliverable (invalid phone number)
 * - 131047: Re-engagement message not sent (user needs to message first)
 *
 * Template Issues:
 * - 132000: Template does not exist
 * - 132001: Template paused
 * - 132005: Template status invalid
 * - 132012: Template parameter count mismatch
 * - 132015: Template parameter format mismatch
 *
 * Account Issues:
 * - 368: Temporarily blocked for policy violations
 * - 131031: Account is restricted
 *
 * General:
 * - 100: Invalid parameter
 * - 190: Access token expired
 */

export const ERROR_CODE_MESSAGES: Record<number, string> = {
  80007: 'Rate limit hit. Please slow down sending.',
  130429: 'Rate limit exceeded. Too many messages sent.',
  131026: 'Invalid phone number or recipient not on WhatsApp.',
  131047: 'User has not initiated conversation. Cannot send template.',
  132000: 'Template does not exist or is not approved.',
  132001: 'Template is paused by Meta.',
  132005: 'Template has invalid status.',
  132012: 'Template parameter count mismatch.',
  132015: 'Template parameter format mismatch.',
  368: 'Account temporarily blocked for policy violations.',
  131031: 'Account is restricted.',
  100: 'Invalid parameter.',
  190: 'Access token expired.',
};

export function getErrorMessage(code: number): string {
  return ERROR_CODE_MESSAGES[code] || `Unknown error (code: ${code})`;
}
