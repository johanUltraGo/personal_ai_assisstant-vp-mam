export interface NotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface Notifier {
  /** Returns true if delivery succeeded. Must never throw for a normal
   * delivery failure — throw only for programmer error. */
  send(payload: NotificationPayload): Promise<boolean>;
}

/**
 * Phase 1/2 default: logs to the server console and is always
 * "delivered". This stands in for real phone push (Firebase Cloud
 * Messaging) until a Firebase project + device tokens are available —
 * see planning.md §11 (hosting/credentials still to be confirmed).
 * Swapping in a real push notifier later means implementing this same
 * Notifier interface; nothing else in the reminder/morning-list code
 * needs to change.
 */
export class ConsoleNotifier implements Notifier {
  async send(payload: NotificationPayload): Promise<boolean> {
    // eslint-disable-next-line no-console
    console.log(`[notify] ${payload.title}: ${payload.body}`, payload.data ?? {});
    return true;
  }
}
