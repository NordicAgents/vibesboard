import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookToken, verifyWebhookSignature } from "@/lib/webhooks/verification";
import {
  WebhookVerificationSchema,
  WebhookPayloadSchema,
} from "@/lib/webhooks/schema";
import { z } from "zod";

/**
 * Handle webhook verification (GET request)
 * Used by third-party services to verify the webhook URL
 *
 * Expected query parameters:
 * - hub.mode: "subscribe"
 * - hub.verify_token: verification token (must match WEBHOOK_VERIFY_TOKEN)
 * - hub.challenge: challenge string to echo back
 *
 * Returns:
 * - 200: Challenge string if verification succeeds
 * - 403: If verification fails
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const webhookSecret = process.env.VERIFY_TOKEN;

  if (!webhookSecret) {
    console.error("❌ WEBHOOK_SECRET not configured");
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 }
    );
  }

  try {
    // Parse and validate query parameters
    const params = {
      "hub.mode": searchParams.get("hub.mode"),
      "hub.verify_token": searchParams.get("hub.verify_token"),
      "hub.challenge": searchParams.get("hub.challenge"),
    };

    console.log("🔍 Webhook Verification Attempt", {
      mode: params["hub.mode"],
      tokenProvided: params["hub.verify_token"] ? "YES" : "NO",
      challengeProvided: params["hub.challenge"] ? "YES" : "NO",
    });

    // Validate schema
    const validatedParams = WebhookVerificationSchema.parse(params);

    // Verify mode and token
    if (validatedParams["hub.mode"] !== "subscribe") {
      console.warn(`❌ Invalid mode: ${validatedParams["hub.mode"]}`);
      return NextResponse.json(
        { error: "Invalid hub mode" },
        { status: 403 }
      );
    }

    // Verify token
    const tokenValid = verifyWebhookToken(
      validatedParams["hub.verify_token"],
      webhookSecret
    );

    if (!tokenValid) {
      console.warn("❌ Webhook verification failed: Token mismatch");
      return NextResponse.json(
        { error: "Verification failed" },
        { status: 403 }
      );
    }

    console.log("✅ Webhook verification successful!");
    console.log(`✅ Returning challenge: ${validatedParams["hub.challenge"]}`);

    // Return challenge to verify webhook
    return new NextResponse(validatedParams["hub.challenge"], {
      status: 200,
      headers: {
        "Content-Type": "text/plain",
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("❌ Validation error:", error.errors);
      return NextResponse.json(
        { error: "Invalid parameters", details: error.errors },
        { status: 400 }
      );
    }

    console.error("❌ Webhook verification error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}


