import { Notifier, NotificationPayload } from "./notifier";
import { GmailConnector } from "../connectors/gmailConnector";

/**
 * Every phone notification (reminders, the morning list, event questions) is
 * also emailed to her Gmail (VP_EMAIL), so she gets it even when the phone has
 * notifications off. Delivered if either the phone or the email accepted it;
 * an email that was sent counts as delivered at once.
 */
export class EmailAlsoNotifier implements Notifier {
  private emailed = false;

  constructor(private readonly phone: Notifier, private readonly gmail: () => Promise<GmailConnector>, private readonly to: string) {}

  get confirmsDelivery(): boolean {
    return this.emailed || this.phone.confirmsDelivery !== false;
  }

  async send(payload: NotificationPayload): Promise<boolean> {
    this.emailed = false;
    let pushed = false;
    try {
      pushed = await this.phone.send(payload);
    } catch {
      pushed = false;
    }
    if (payload.data?.noEmail !== "true") {
      try {
        const gmail = await this.gmail();
        if (gmail.health().configured) {
          await gmail.send({ to: this.to, subject: `VP Assistant: ${payload.title}`, body: `${payload.body}\n\nYour VP Assistant` });
          this.emailed = true;
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[notify] email copy failed:", (err as Error).message);
      }
    }
    return pushed || this.emailed;
  }
}
