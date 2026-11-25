import { handleSchedule } from "@vercel/schedules";
import { runTick } from "../src/scheduler/tick";

export const POST = handleSchedule(async () => {
  const errors = await runTick();
  if (errors.length) throw new Error(errors.join("; "));
});
