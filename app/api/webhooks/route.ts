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
 * Receives incoming messages and sends acknowledgment
 */
export async function POST(request: NextRequest) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  try {
    const body = await request.json();

    console.log("📨 Incoming message received");

    // Extract message from nested structure
    const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) {
      return NextResponse.json({ success: true }, { status: 200 });
    }

    const senderPhone = message.from;
    const messageType = message.type;

    console.log(`📱 Message from ${senderPhone} (type: ${messageType})`);

    // Extract message text based on type
    let messageText = "";
    if (message.type === "text") {
      messageText = message.text.body;
    } else if (message.type === "interactive") {
      messageText = message.interactive?.button_reply?.title ||
                   message.interactive?.list_reply?.id ||
                   "Interactive message";
    } else if (message.type === "audio") {
      messageText = "🎤 Voice message";
    } else if (message.type === "image") {
      messageText = "🖼️ Image";
    } else if (message.type === "document") {
      messageText = "📄 Document";
    } else {
      messageText = `${messageType} message`;
    }

    // Send acknowledgment
    if (phoneNumberId && accessToken) {
      try {
        console.log(`📤 Sending acknowledgment to ${senderPhone}...`);
        await sendWhatsAppMessage({
          to: senderPhone,
          response: {
            type: "text",
            text: `✅ Message received!\n\nYou said: "${messageText}"`,
          },
          phoneNumberId,
          accessToken,
        });
        console.log(`✅ Acknowledgment sent`);
      } catch (error) {
        console.error(`⚠️ Could not send acknowledgment:`, error);
      }
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("❌ Error:", error);
    // Always return 200 to acknowledge receipt
    return NextResponse.json({ success: true }, { status: 200 });
  }
}


