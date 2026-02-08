/**
 * WhatsApp message types and interfaces
 */

export interface BotResponse {
  text: string;
  type: "text" | "buttons" | "list" | "flow";
  buttons?: string[];
  options?: { id: string; title: string; description?: string }[];
  flow?: {
    flow_id: string;
    screen: string;
    data?: Record<string, unknown>;
    cta_text: string;
    mode?: "draft" | "published";
  };
}

export interface SendMessageParams {
  to: string;
  response: BotResponse;
  phoneNumberId: string;
  accessToken: string;
}

export interface WhatsAppAPIResponse {
  messages?: Array<{ id: string }>;
  error?: {
    message: string;
    code: number;
  };
}
