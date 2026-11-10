import { Connector, ConnectorHealth, ConnectorNotConfiguredError } from "./connector";

export interface OutboundWhatsApp {
  to: string;
  body: string;
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
    if (!response.ok) throw new Error(`WhatsApp rejected the message (${response.status}): ${await response.text()}`);
    const data = (await response.json()) as { messages?: Array<{ id: string }> };
    return { id: data.messages?.[0]?.id ?? "unknown" };
  }
}

/**
 * WhatsApp is listed in the registry (so the plug-in architecture
 * requirement — spec §7 — covers it) but is NOT implemented for real
 * sending. Per planning.md §11.2 item 14: there is no general,
 * compliant way for a third-party assistant to send from a personal
 * WhatsApp account. The only legitimate path is the paid WhatsApp
 * Business Platform via an approved provider, which requires a
 * business decision and account setup this project does not have.
 * `health()` always reports unconfigured with that explanation;
 * `send()` always throws. This is intentional, not a stub to "finish
 * later" silently — it needs her decision first (see final report).
 */
export class WhatsAppConnector implements Connector {
  readonly type = "whatsapp";

  constructor(private readonly client?: WhatsAppClient) {}

  health(): ConnectorHealth {
    if (this.client) return { configured: true, detail: "WhatsApp Business Cloud API connector is ready." };
    return {
      configured: false,
      detail:
        "WhatsApp sending is not implemented: no compliant automated-sending path has been " +
        "confirmed (see planning.md §11.2 #14 — requires a decision on the paid WhatsApp " +
        "Business Platform vs. not building this feature).",
    };
  }

  async send(message?: OutboundWhatsApp): Promise<{ id: string }> {
    if (this.client && message) return this.client.send(message);
    throw new ConnectorNotConfiguredError(
      "WhatsApp sending is blocked pending a decision on the WhatsApp Business Platform (see planning.md §11.2 #14)."
    );
  }
}

/** Uses only Meta's approved WhatsApp Business Cloud API, never browser or personal-account automation. */
export function whatsappFromEnvironment() {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  return new WhatsAppConnector(accessToken && phoneNumberId ? new WhatsAppCloudApiClient(accessToken, phoneNumberId) : undefined);
}
