import cron, { ScheduledTask } from "node-cron";
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

/** Registers the 9:00 AM daily job (spec §3). Not started automatically
 * on import — call start() from the server entrypoint so tests can
 * import this module without side effects. */
export function start(): ScheduledTask {
  return cron.schedule("0 9 * * *", () => {
    runMorningListJob().catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[morning-list] failed to generate:", err);
    });
  }, { timezone: schoolTimezone() });
}
