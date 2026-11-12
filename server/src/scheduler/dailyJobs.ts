import cron, { ScheduledTask } from "node-cron";
import { schoolTimezone } from "../services/morningListService";
import { raiseDuePrompts, syncConfiguredCalendar } from "../services/calendarService";
import { notifierFromEnvironment } from "../notifiers/notifier";
import { backupDatabase } from "../services/backupService";
import { deleteOldConversations } from "../services/retentionService";

async function syncCalendar() {
  try {
    await syncConfiguredCalendar();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[calendar] sync failed:", (err as Error).message);
  }
}

async function eventAlerts() {
  try {
    await raiseDuePrompts(new Date(), await notifierFromEnvironment());
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[calendar] alerts failed:", err);
  }
}

async function backup() {
  try {
    await deleteOldConversations();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[privacy] chat cleanup failed:", (err as Error).message);
  }
  try {
    await backupDatabase();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[backup] failed:", (err as Error).message);
  }
}

/**
 * Design §6: 08:55 calendar sync (spec §6 "checks it every time it runs"),
 * 09:00 event alerts (just after the 9:00 work list), and on startup a sync
 * plus alerts if it is between 9 AM and 6 PM. 02:00: daily backup of her data.
 */
export function start(): ScheduledTask[] {
  const timezone = schoolTimezone();
  void syncCalendar().then(eventAlerts);
  return [
    cron.schedule("55 8 * * *", () => void syncCalendar(), { timezone }),
    cron.schedule("1 9 * * *", () => void eventAlerts(), { timezone }),
    cron.schedule("0 2 * * *", () => void backup(), { timezone }),
  ];
}
