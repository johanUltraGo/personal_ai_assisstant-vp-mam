import cron, { ScheduledTask } from "node-cron";
import { DateTime } from "luxon";
import { prisma } from "../db";
import { buildMorningList, schoolTimezone } from "../services/morningListService";
import { notifierFromEnvironment } from "../notifiers/notifier";
import { logActivity } from "../services/activityService";

export async function runMorningListJob() {
  const list = await buildMorningList();
  await logActivity("morning_list.built", `Prepared and sent the work list for ${list.date}: ${list.tasks.length} task(s).`);
  const first = list.tasks.slice(0, 3).map((t) => t.title).join(", ");
  const notifier = await notifierFromEnvironment();
  await notifier.send({
    title: "Your work list for today",
    body: list.tasks.length
      ? `${list.tasks.length} task(s): ${first}${list.tasks.length > 3 ? "…" : ""}. Tap to confirm or change.`
      : "Nothing is scheduled today.",
    data: { date: list.date ?? "", url: "/#morning-list-section" },
  });
  return list;
}

/**
 * Catch-up after a restart: the cloud host may restart the server at any
 * time, so if it starts between 9 AM and 6 PM and today's list has not been
 * sent yet, send it now. Returns true when it sent the list.
 */
export async function sendMissedMorningList(now: Date = new Date()): Promise<boolean> {
  const local = DateTime.fromJSDate(now, { zone: schoolTimezone() });
  if (local.hour < 9 || local.hour >= 18) return false;
  const sentToday = await prisma.activityLog.findFirst({
    where: { kind: "morning_list.built", at: { gte: local.startOf("day").toJSDate() } },
  });
  if (sentToday) return false;
  await runMorningListJob();
  return true;
}

/** Registers the 9:00 AM daily job (spec §3). Not started automatically
 * on import — call start() from the server entrypoint so tests can
 * import this module without side effects. */
export function start(): ScheduledTask {
  sendMissedMorningList().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[morning-list] catch-up failed:", err);
  });
  return cron.schedule("0 9 * * *", () => {
    runMorningListJob().catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[morning-list] failed to generate:", err);
    });
  }, { timezone: schoolTimezone() });
}
