import cron, { ScheduledTask } from "node-cron";
import { buildMorningList, schoolTimezone } from "../services/morningListService";
import { ConsoleNotifier } from "../notifiers/notifier";

const notifier = new ConsoleNotifier();

export async function runMorningListJob() {
  const list = await buildMorningList();
  await notifier.send({
    title: "Your work list for today",
    body: `${list.tasks.length} task(s) for ${list.date}`,
    data: { date: list.date ?? "" },
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
