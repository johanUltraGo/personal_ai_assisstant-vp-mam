export interface NotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface Notifier {
  /** Returns true if the notification was accepted for delivery. Must never
   * throw for a normal delivery failure — throw only for programmer error. */
  send(payload: NotificationPayload): Promise<boolean>;
  /** False when the phone confirms delivery separately (Web Push). */
  readonly confirmsDelivery?: boolean;
}

/**
 * Development stand-in: logs to the server console and counts as delivered.
 * Used whenever Web Push (VAPID keys) is not configured.
 */
export class ConsoleNotifier implements Notifier {
  readonly confirmsDelivery = true;

  async send(payload: NotificationPayload): Promise<boolean> {
    // eslint-disable-next-line no-console
    console.log(`[notify] ${payload.title}: ${payload.body}`, payload.data ?? {});
    return true;
  }
}

/** Web Push when VAPID keys are set (design §9), otherwise the console. */
export async function notifierFromEnvironment(): Promise<Notifier> {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return new ConsoleNotifier();
  const { WebPushNotifier } = await import("./webPushNotifier");
  const webpush = (await import("web-push")).default;
  try {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.com", publicKey, privateKey);
  } catch (err) {
    // Invalid keys: notifications will fail and reminders surface as FAILED in the app.
    // eslint-disable-next-line no-console
    console.error("[push] VAPID keys are invalid:", (err as Error).message);
  }
  return new WebPushNotifier();
}
