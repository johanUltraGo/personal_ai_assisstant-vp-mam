import { Notifier, NotificationPayload } from "./notifier";
import { GmailConnector } from "../connectors/gmailConnector";
import { SelfWhatsApp } from "../connectors/whatsappSelf";

/**
 * Delivers her notifications where she wants them (payload.data.channel):
 * - none:     phone + Gmail copy (reminders, morning list, event questions)
 * - EMAIL:    Gmail only
 * - WHATSAPP: WhatsApp to her own number, with a Gmail copy as backup
 * - PHONE:    phone only
 * Delivered if any route accepted it; an email or WhatsApp that went out
 * counts as delivered at once (only Web Push confirms later from the phone).
 */
export class EmailAlsoNotifier implements Notifier {
  private confirmedNow = false;

  constructor(
    private readonly phone: Notifier,
    private readonly gmail: () => Promise<GmailConnector>,
    private readonly to: string | undefined,
    private readonly whatsapp: SelfWhatsApp | null = null
  ) {}

  get confirmsDelivery(): boolean {
    return this.confirmedNow || this.phone.confirmsDelivery !== false;
  }

  async send(payload: NotificationPayload): Promise<boolean> {
    this.confirmedNow = false;
    const channel = payload.data?.channel;
    const usePhone = !channel || channel === "PHONE";
    const useWhatsApp = channel === "WHATSAPP";
    const useEmail = payload.data?.noEmail !== "true" && channel !== "PHONE";

    let pushed = false;
    if (usePhone) {
      try { pushed = await this.phone.send(payload); } catch { pushed = false; }
    }
    if (useWhatsApp && this.whatsapp) {
      try {
        await this.whatsapp.send(`${payload.title}: ${payload.body}`);
        this.confirmedNow = true;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[notify] WhatsApp failed:", (err as Error).message);
      }
    }
    if (useEmail && this.to) {
      try {
        const gmail = await this.gmail();
        if (gmail.health().configured) {
          await gmail.send({ to: this.to, subject: `VP Assistant: ${payload.title}`, body: `${payload.body}\n\nYour VP Assistant` });
          this.confirmedNow = true;
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[notify] email copy failed:", (err as Error).message);
      }
    }
    // A WhatsApp reminder with no WhatsApp set up and no email still tries the phone.
    if (useWhatsApp && !this.confirmedNow && !pushed) {
      try { pushed = await this.phone.send(payload); } catch { pushed = false; }
    }
    return pushed || this.confirmedNow;
  }
}
