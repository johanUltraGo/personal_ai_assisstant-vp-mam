import webpush from "web-push";
import { prisma } from "../db";
import { NotificationPayload, Notifier } from "./notifier";

type Sender = typeof webpush.sendNotification;

/**
 * Phone notifications through the browser's Web Push service (spec §10,
 * "phone notifications"). A send counts as SENT when at least one of her
 * subscribed devices accepted it; DELIVERED is recorded only when the phone's
 * service worker confirms it showed the notification.
 */
export class WebPushNotifier implements Notifier {
  readonly confirmsDelivery = false;

  constructor(private readonly sender: Sender = webpush.sendNotification.bind(webpush)) {}

  async send(payload: NotificationPayload): Promise<boolean> {
    const subscriptions = await prisma.pushSubscription.findMany();
    let accepted = false;
    for (const sub of subscriptions) {
      try {
        await this.sender(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title: payload.title, body: payload.body, data: payload.data ?? {} }),
          { TTL: 3600, urgency: "high" }
        );
        accepted = true;
        await prisma.pushSubscription.update({ where: { id: sub.id }, data: { lastSuccessAt: new Date() } });
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        } else {
          // eslint-disable-next-line no-console
          console.error("[push] send failed:", status, (err as Error).message);
        }
      }
    }
    return accepted;
  }
}
