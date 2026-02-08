import { z } from "zod";

/**
 * Webhook verification request (GET)
 * Used for initial webhook setup verification
 */
export const WebhookVerificationSchema = z.object({
  "hub.mode": z.string().describe("Subscription mode (e.g., 'subscribe')"),
  "hub.verify_token": z.string().describe("Verification token"),
  "hub.challenge": z.string().describe("Challenge string to echo back"),
});

export type WebhookVerification = z.infer<typeof WebhookVerificationSchema>;

/**
 * Generic webhook payload schema
 * Used for POST requests containing event data
 */
export const WebhookPayloadSchema = z.object({
  object: z.string().describe("Webhook object type"),
  entry: z.array(
    z.object({
      id: z.string(),
      time: z.number(),
      changes: z.array(z.record(z.unknown())).optional(),
    })
  ),
});

export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;

/**
 * Webhook error response schema
 */
export const WebhookErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    code: z.number(),
  }),
});

export type WebhookError = z.infer<typeof WebhookErrorSchema>;
