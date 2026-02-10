import { sendWhatsAppMessage } from "./sender";
import { activateConnection } from "./connections";
import type { WhatsAppAgentConnection } from "./types";

interface Agent {
  id: string;
  name: string;
  mode: "provider" | "collector";
  greeting_text: string | null;
  instructions: string;
}

/**
 * Build introduction message for agent
 */
export function buildIntroMessage(
  agent: Agent,
  customMessage?: string | null
): string {
  if (customMessage) {
    return customMessage;
  }

  const greeting = agent.greeting_text || "Hi! How can I help you today?";

  const purpose =
    agent.mode === "collector"
      ? "I'd love to collect your feedback and hear your thoughts"
      : "I'm here to answer your questions and provide assistance";

  return `👋 Hi! I'm **${agent.name}**.

${greeting}

${purpose}. Feel free to message me anytime!`;
}

/**
 * Build intro buttons based on agent mode
 */
export function buildIntroButtons(agent: Agent): string[] {
  if (agent.mode === "collector") {
    return ["Get Started", "Learn More", "Not Now"];
  }

  return ["Ask Question", "Learn More", "Maybe Later"];
}

/**
 * Send introduction message to WhatsApp user
 */
export async function sendIntroductionMessage(
  connection: WhatsAppAgentConnection,
  agent: Agent
): Promise<boolean> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    console.error("❌ WhatsApp credentials not configured");
    return false;
  }

  const message = buildIntroMessage(agent, connection.custom_intro_message);
  const buttons = buildIntroButtons(agent);

  try {
    console.log(`📤 Sending introduction to ${connection.phone_number}...`);

    const result = await sendWhatsAppMessage({
      to: connection.phone_number,
      response: {
        type: "buttons",
        text: message,
        buttons,
      },
      phoneNumberId,
      accessToken,
    });

    if (result.messages && result.messages.length > 0) {
      const messageId = result.messages[0].id;

      // Update connection to active
      await activateConnection(connection.id, messageId);

      console.log(`✅ Intro message sent successfully. Message ID: ${messageId}`);
      return true;
    }

    return false;
  } catch (error) {
    console.error(`❌ Failed to send intro to ${connection.phone_number}:`, error);
    return false;
  }
}

/**
 * Resend introduction message
 */
export async function resendIntroductionMessage(
  connectionId: string,
  agent: Agent
): Promise<boolean> {
  const { findConnectionById } = await import("./connections");

  const connection = await findConnectionById(connectionId);

  if (!connection) {
    console.error(`❌ Connection not found: ${connectionId}`);
    return false;
  }

  return sendIntroductionMessage(connection, agent);
}
