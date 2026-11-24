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

export function whatsappSelfFromEnvironment(): SelfWhatsApp | null {
  const provider = (process.env.WHATSAPP_SELF_PROVIDER || "callmebot").toLowerCase();
  const phone = process.env.VP_WHATSAPP_NUMBER?.trim();
  if (!phone) return null;
  if (provider === "callmebot") {
    const key = process.env.CALLMEBOT_API_KEY?.trim();
    return key ? new CallMeBotWhatsApp(phone, key) : null;
  }
  return null;
}
