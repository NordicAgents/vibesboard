import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookToken, verifyWebhookSignature } from "@/lib/webhooks/verification";
import {
  WebhookVerificationSchema,
  WebhookPayloadSchema,
} from "@/lib/webhooks/schema";
import { sendWhatsAppMessage } from "@/lib/whatsapp/sender";
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

    // Send welcome message after verification
    try {
      const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
      const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

      if (phoneNumberId && accessToken) {
        // Extract receiver phone from query params (if provided)
        const receiverPhone = searchParams.get("receiver");

        if (receiverPhone) {
          console.log("📤 Sending welcome message to:", receiverPhone);

          await sendWhatsAppMessage({
            to: receiverPhone,
            response: {
              type: "text",
              text: "🎉 Welcome to VibeAgent! Webhook verification successful. Your bot is now ready to receive messages.",
            },
            phoneNumberId,
            accessToken,
          });

          console.log("✅ Welcome message sent successfully!");
        }
      }
    } catch (error) {
      console.error("⚠️ Could not send welcome message:", error);
      // Don't fail verification if message sending fails
    }

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

/**
 * Handle webhook events (POST request)
 * Receives incoming messages from WhatsApp users and sends responses
 *
 * Expected headers:
 * - x-hub-signature-256: HMAC-SHA256 signature (format: sha256=...)
 *
 * Returns:
 * - 200: Webhook processed successfully
 * - 401: If signature verification fails
 * - 400: If payload is invalid
 * - 500: If internal error occurs
 */
export async function POST(request: NextRequest) {
  const webhookSecret = process.env.VERIFY_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!webhookSecret) {
    console.error("❌ VERIFY_TOKEN not configured");
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 }
    );
  }

  if (!phoneNumberId || !accessToken) {
    console.error("❌ WhatsApp configuration missing");
    return NextResponse.json(
      { error: "WhatsApp configuration not found" },
      { status: 500 }
    );
  }

  try {
    // Get raw request body as text for signature verification
    const rawBody = await request.text();

    console.log("📨 Incoming webhook request received");

    // Get signature from headers
    const signature = request.headers.get("x-hub-signature-256");

    if (!signature) {
      console.warn("❌ Missing signature header (x-hub-signature-256)");
      return NextResponse.json(
        { error: "Missing signature header" },
        { status: 401 }
      );
    }

    // Verify webhook signature - TODO
    // const isValid = verifyWebhookSignature(rawBody, signature, webhookSecret);

    // if (!isValid) {
    //   console.warn("❌ Webhook signature verification failed");
    //   return NextResponse.json(
    //     { error: "Invalid webhook signature" },
    //     { status: 401 }
    //   );
    // }

    // console.log("✅ Webhook signature verified");

    // Parse and validate payload
    const body = JSON.parse(rawBody);
    const validatedPayload = WebhookPayloadSchema.parse(body);

    console.log("✅ Webhook payload validated", {
      object: validatedPayload.object,
      entryCount: validatedPayload.entry.length,
    });

    // Process webhook events
    console.log("📥 Processing incoming messages...");

    for (const entry of validatedPayload.entry) {
      if (entry.changes) {
        for (const change of entry.changes as any[]) {
          const changeValue = change;

          // Handle incoming messages
          if (changeValue.value?.messages) {
            for (const message of changeValue.value.messages) {
              const senderPhone = message.from;
              const messageType = message.type;

              console.log(`📱 Message from ${senderPhone} (type: ${messageType})`);

              let messageText = "";

              // Extract text from different message types
              if (message.type === "text") {
                messageText = message.text.body;
                console.log(`   Text: ${messageText}`);
              } else if (message.type === "interactive") {
                if (message.interactive.type === "button_reply") {
                  messageText = message.interactive.button_reply.title;
                  console.log(`   Button: ${messageText}`);
                } else if (message.interactive.type === "list_reply") {
                  messageText = message.interactive.list_reply.id;
                  console.log(`   List: ${messageText}`);
                }
              } else if (message.type === "audio") {
                messageText = "🎤 Voice message received";
                console.log(`   Audio: ${messageText}`);
              } else if (message.type === "image") {
                messageText = "🖼️ Image received";
                console.log(`   Image: ${messageText}`);
              } else if (message.type === "document") {
                messageText = "📄 Document received";
                console.log(`   Document: ${messageText}`);
              }

              // Send response message
              if (messageText) {
                try {
                  console.log(`📤 Sending response to ${senderPhone}...`);

                  await sendWhatsAppMessage({
                    to: senderPhone,
                    response: {
                      type: "text",
                      text: `👋 Thanks for your message!\n\nYou said: "${messageText}"\n\nI received it and I'm processing your request...`,
                    },
                    phoneNumberId,
                    accessToken,
                  });

                  console.log(`✅ Response sent to ${senderPhone}`);
                } catch (error) {
                  console.error(`❌ Failed to send response to ${senderPhone}:`, error);
                }
              }
            }
          }

          // Handle status updates
          if (changeValue.value?.statuses) {
            for (const status of changeValue.value.statuses) {
              console.log(
                `📊 Status update for message ${status.id}: ${status.status}`
              );
            }
          }
        }
      }
    }

    // Return success response
    return NextResponse.json(
      { success: true, message: "Webhook processed successfully" },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error("❌ Invalid JSON payload:", error);
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    if (error instanceof z.ZodError) {
      console.error("❌ Payload validation error:", error.errors);
      return NextResponse.json(
        { error: "Invalid payload format", details: error.errors },
        { status: 400 }
      );
    }

    console.error("❌ Webhook processing error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}


