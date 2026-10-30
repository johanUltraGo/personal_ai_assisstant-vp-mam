import cron, { ScheduledTask } from "node-cron";
import { runDueReminders } from "../services/reminderService";

/** Due-reminder check every minute (spec §10). Not restricted to the
 * 9:00 AM–6:00 PM connector-alert window (spec §7) — that window applies
 * to school-app/connector polling (Phase 4), not to reminders she
 * personally asked for, which the spec allows her to set at any time,
 * including a week ahead. */
export function start(): ScheduledTask {
  return cron.schedule("* * * * *", () => {
    runDueReminders().catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[reminders] due-check failed:", err);
    });
  });
}
