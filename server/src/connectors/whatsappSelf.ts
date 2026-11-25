/**
 * WhatsApp messages TO HER OWN NUMBER (reminders, alerts), sent automatically.
 * Pluggable: pick the provider with WHATSAPP_SELF_PROVIDER.
 * - "callmebot" (now): free, one-way, only to the number that activated it.
 * - later, "meta": the WhatsApp Cloud API with the assistant's own number,
 *   which also lets her chat with the assistant. Add a class here and a case
 *   in whatsappSelfFromEnvironment; nothing else changes.
 * Messages to other people and groups never use this; they stay tap-to-send.
 */
export interface SelfWhatsApp {
  readonly provider: string;
  send(text: string): Promise<void>;
}

export class CallMeBotWhatsApp implements SelfWhatsApp {
  readonly provider = "callmebot";

  constructor(private readonly phone: string, private readonly apiKey: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async send(text: string): Promise<void> {
    const params = new URLSearchParams({ phone: this.phone.replace(/[^\d+]/g, ""), text, apikey: this.apiKey });
    const response = await this.fetchImpl(`https://api.callmebot.com/whatsapp.php?${params}`);
    const body = await response.text();
    // CallMeBot answers 200 with an HTML page; failures say so in the text.
    if (!response.ok || /error|invalid|not (?:allowed|activated)|apikey is not/i.test(body)) {
      throw new Error(`CallMeBot did not send the WhatsApp message (${response.status}).`);
    }
  }
}

/**
 * Meta's official WhatsApp Cloud API, from the assistant's own number.
 * Reminders use an approved template ("Reminder: {{1}}"), which WhatsApp
 * allows at any time; free text would only work within 24 hours of her last
 * message. The same app and number can later receive her messages (two-way chat).
 */
export class MetaWhatsApp implements SelfWhatsApp {
  readonly provider = "meta";

  constructor(
    private readonly to: string,
    private readonly token: string,
    private readonly phoneNumberId: string,
    private readonly template: string,
    private readonly language: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async send(text: string): Promise<void> {
    // Template parameters may not contain new lines or tabs, or 4+ spaces in a row.
    const param = text.replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ").slice(0, 1000);
    const response = await this.fetchImpl(`https://graph.facebook.com/v21.0/${encodeURIComponent(this.phoneNumberId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: this.to.replace(/\D/g, ""),
        type: "template",
        template: { name: this.template, language: { code: this.language }, components: [{ type: "body", parameters: [{ type: "text", text: param }] }] },
      }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`WhatsApp (Meta) did not send the message (${response.status}): ${detail}`);
    }
  }
}

export function whatsappSelfFromEnvironment(): SelfWhatsApp | null {
  const provider = (process.env.WHATSAPP_SELF_PROVIDER || "callmebot").toLowerCase();
  const phone = process.env.VP_WHATSAPP_NUMBER?.trim();
  if (!phone) return null;
  if (provider === "callmebot") {
    const key = process.env.CALLMEBOT_API_KEY?.trim();
    return key ? new CallMeBotWhatsApp(phone, key) : null;
  }
  if (provider === "meta") {
    const token = process.env.META_WA_TOKEN?.trim();
    const phoneNumberId = process.env.META_WA_PHONE_NUMBER_ID?.trim();
    if (!token || !phoneNumberId) return null;
    return new MetaWhatsApp(phone, token, phoneNumberId, process.env.META_WA_TEMPLATE?.trim() || "vp_reminder", process.env.META_WA_TEMPLATE_LANG?.trim() || "en");
  }
  return null;
}
