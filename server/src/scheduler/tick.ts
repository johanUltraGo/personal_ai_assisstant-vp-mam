import { DateTime } from "luxon";
import { prisma } from "../db";
import { runDueReminders } from "../services/reminderService";
import { notifierFromEnvironment } from "../notifiers/notifier";
import { schoolTimezone } from "../services/morningListService";
import { sendMissedMorningList } from "./morningListScheduler";
import { raiseDuePrompts, syncConfiguredCalendar } from "../services/calendarService";
import { warnIfCalendarEnding } from "../services/calendarExpiryService";
import { gmailConnector } from "../connectors/registry";
import { deleteOldConversations } from "../services/retentionService";
import { logActivity } from "../services/activityService";

/**
 * For hosts without a long-running process (Vercel): called on a schedule
 * (every 15 minutes), it does everything node-cron would have done since the
 * last call. Each daily job runs once per school day, after its usual time.
 */
async function onceToday(kind: string, afterHour: number, now: Date, job: () => Promise<unknown>) {
  const local = DateTime.fromJSDate(now, { zone: schoolTimezone() });
  if (local.hour < afterHour) return;
  const done = await prisma.activityLog.findFirst({ where: { kind, at: { gte: local.startOf("day").toJSDate() } } });
  if (done) return;
  await logActivity(kind, `Daily job ${kind} ran.`);
  await job();
}

export async function runTick(now: Date = new Date()): Promise<string[]> {
  const errors: string[] = [];
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try { await fn(); } catch (err) { errors.push(`${name}: ${(err as Error).message}`); console.error(`[tick] ${name} failed:`, err); }
  };
  const notifier = await notifierFromEnvironment();
  await step("reminders", () => runDueReminders(now, notifier));
  await step("morning list", () => sendMissedMorningList(now));
  await step("calendar", () => onceToday("cron.calendar", 9, now, async () => {
    await syncConfiguredCalendar().catch((e) => console.error("[tick] calendar sync:", e.message));
    await raiseDuePrompts(now, notifier);
  }));
  await step("calendar expiry", () => onceToday("cron.calendar_expiry", 9, now, async () => warnIfCalendarEnding(await gmailConnector(), notifier, now)));
  await step("cleanup", () => onceToday("cron.cleanup", 2, now, () => deleteOldConversations()));
  return errors;
}
