import { Connector, ConnectorHealth, ConnectorNotConfiguredError } from "./connector";

export interface OutboundWhatsApp {
  to: string;
  body: string;
}

/** Meta error 131047: free text is only allowed within 24 hours of the person's last message. */
export class WhatsAppWindowError extends Error {
  constructor() {
    super("WhatsApp Business can only send free text to someone who messaged the school number in the last 24 hours.");
  }
}

export interface WhatsAppClient {
  send(message: OutboundWhatsApp): Promise<{ id: string }>;
}

class WhatsAppCloudApiClient implements WhatsAppClient {
  constructor(private readonly accessToken: string, private readonly phoneNumberId: string) {}

  async send(message: OutboundWhatsApp): Promise<{ id: string }> {
    const response = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(this.phoneNumberId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: message.to.replace(/^\+/, ""), type: "text", text: { body: message.body } }),
    });
    if (!response.ok) {
      const text = await response.text();
      if (text.includes("131047")) throw new WhatsAppWindowError();
      throw new Error(`WhatsApp rejected the message (${response.status}): ${text}`);
    }
    const data = (await response.json()) as { messages?: Array<{ id: string }> };
    return { id: data.messages?.[0]?.id ?? "unknown" };
  }
}

/**
 * WhatsApp (design §4, Uma wants both email and WhatsApp). Two compliant paths:
 * - Meta's WhatsApp Business Cloud API, used only for an individual with a
 *   number when WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID are set;
 * - otherwise, and always for groups, the message is handed to WhatsApp on her
 *   phone (wa.me link with the text typed) and she taps send herself.
 * No personal-account or browser automation is ever used.
 */
export class WhatsAppConnector implements Connector {
  readonly type = "whatsapp";

  constructor(private readonly client?: WhatsAppClient) {}

  get apiConfigured(): boolean {
    return !!this.client;
  }

  health(): ConnectorHealth {
    if (this.client) return { configured: true, detail: "WhatsApp Business API sends to individuals; groups open in WhatsApp for you to tap send." };
    return {
      configured: true,
      detail: "WhatsApp opens on your phone with the message typed for you to tap send (Business API not set up).",
    };
  }

  async send(message?: OutboundWhatsApp): Promise<{ id: string }> {
    if (this.client && message) return this.client.send(message);
    throw new ConnectorNotConfiguredError("The WhatsApp Business API is not set up.");
  }
}

/** Uses only Meta's approved WhatsApp Business Cloud API, never browser or personal-account automation. */
export function whatsappFromEnvironment() {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  return new WhatsAppConnector(accessToken && phoneNumberId ? new WhatsAppCloudApiClient(accessToken, phoneNumberId) : undefined);
}

/** wa.me link with the message typed. No number opens the chat picker so she can choose a group. */
export function whatsappHandoffUrl(number: string | null | undefined, body: string): string {
  const digits = (number ?? "").replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(body)}`;
}
