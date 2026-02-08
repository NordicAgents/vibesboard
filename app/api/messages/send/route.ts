import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sendWhatsAppMessage } from "@/lib/whatsapp/sender";
import { BotResponse } from "@/lib/whatsapp/message-types";

/**
 * Send Message Request Schema
 */
const SendMessageSchema = z.object({
  to: z.string().min(1, "Recipient phone number is required"),
  message: z.object({
    text: z.string().min(1, "Message text is required"),
    type: z.enum(["text", "buttons", "list", "flow"]).default("text"),
    buttons: z.array(z.string()).optional(),
    options: z
      .array(
        z.object({
          id: z.string(),
          title: z.string(),
          description: z.string().optional(),
        })
      )
      .optional(),
    flow: z
      .object({
        flow_id: z.string(),
        screen: z.string(),
        data: z.record(z.unknown()).optional(),
        cta_text: z.string(),
        mode: z.enum(["draft", "published"]).optional(),
      })
      .optional(),
  }),
});

/**
 * POST /api/messages/send
 *
 * Send a WhatsApp message to a user
 *
 * Request body:
 * {
 *   "to": "1234567890",
 *   "message": {
 *     "text": "Hello!",
 *     "type": "text"
 *   }
 * }
 *
 * For buttons:
 * {
 *   "to": "1234567890",
 *   "message": {
 *     "text": "Choose an option",
 *     "type": "buttons",
 *     "buttons": ["Option 1", "Option 2"]
 *   }
 * }
 *
 * For list:
 * {
 *   "to": "1234567890",
 *   "message": {
 *     "text": "Select from list",
 *     "type": "list",
 *     "options": [
 *       { "id": "1", "title": "Item 1", "description": "Description 1" },
 *       { "id": "2", "title": "Item 2", "description": "Description 2" }
 *     ]
 *   }
 * }
 *
 * Required environment variables:
 * - WHATSAPP_PHONE_NUMBER_ID
 * - WHATSAPP_ACCESS_TOKEN
 */
export async function POST(request: NextRequest) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  // Validate environment variables
  if (!phoneNumberId || !accessToken) {
    console.error("❌ Missing WhatsApp configuration");
    return NextResponse.json(
      {
        error: "WhatsApp configuration not found",
        details: {
          phoneNumberId: !phoneNumberId ? "Missing" : "Configured",
          accessToken: !accessToken ? "Missing" : "Configured",
        },
      },
      { status: 500 }
    );
  }

  try {
    // Parse request body
    const body = await request.json();

    // Validate request
    const validatedData = SendMessageSchema.parse(body);

    console.log("📨 Send Message Request", {
      to: validatedData.to,
      messageType: validatedData.message.type,
    });

    // Send message
    const result = await sendWhatsAppMessage({
      to: validatedData.to,
      response: validatedData.message as BotResponse,
      phoneNumberId,
      accessToken,
    });

    // Return success response
    return NextResponse.json(
      {
        success: true,
        message: "Message sent successfully",
        messageId: result.messages?.[0]?.id,
      },
      { status: 200 }
    );
  } catch (error) {
    // Handle validation errors
    if (error instanceof z.ZodError) {
      console.error("❌ Validation error:", error.errors);
      return NextResponse.json(
        {
          error: "Invalid request format",
          details: error.errors.map((err) => ({
            field: err.path.join("."),
            message: err.message,
          })),
        },
        { status: 400 }
      );
    }

    // Handle API errors
    if (error instanceof Error) {
      console.error("❌ Error sending message:", error.message);

      // Check for specific error types
      if (error.message.includes("WHATSAPP_AUTH_EXPIRED")) {
        return NextResponse.json(
          {
            error: "WhatsApp authentication failed",
            details: error.message,
          },
          { status: 401 }
        );
      }

      if (error.message.includes("WhatsApp API Error")) {
        return NextResponse.json(
          {
            error: "WhatsApp API error",
            details: error.message,
          },
          { status: 400 }
        );
      }

      return NextResponse.json(
        {
          error: "Failed to send message",
          details: error.message,
        },
        { status: 500 }
      );
    }

    // Generic error handler
    console.error("❌ Unknown error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/messages/send
 * Returns information about the endpoint
 */
export async function GET() {
  return NextResponse.json(
    {
      message: "WhatsApp Message Sender API",
      endpoint: "POST /api/messages/send",
      description: "Send WhatsApp messages to users",
      usage: {
        text: {
          to: "recipient_phone_number",
          message: {
            text: "Your message here",
            type: "text",
          },
        },
        buttons: {
          to: "recipient_phone_number",
          message: {
            text: "Choose an option",
            type: "buttons",
            buttons: ["Option 1", "Option 2"],
          },
        },
        list: {
          to: "recipient_phone_number",
          message: {
            text: "Select from list",
            type: "list",
            options: [
              { id: "1", title: "Item 1", description: "Description" },
            ],
          },
        },
      },
      requiredEnv: {
        WHATSAPP_PHONE_NUMBER_ID: "Your WhatsApp Phone Number ID",
        WHATSAPP_ACCESS_TOKEN: "Your WhatsApp Access Token",
      },
    },
    { status: 200 }
  );
}
