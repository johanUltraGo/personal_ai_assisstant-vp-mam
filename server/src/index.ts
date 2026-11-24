import "dotenv/config";
import { createApp } from "./app";
import { start as startMorningListScheduler } from "./scheduler/morningListScheduler";
import { start as startReminderScheduler } from "./scheduler/reminderScheduler";
import { start as startDailyJobs } from "./scheduler/dailyJobs";

const port = Number(process.env.PORT) || 4000;
const app = createApp();

// Without a PIN, listen only on this computer (design §5).
// Without a PIN the app stays on this PC only, unless the owner explicitly
// allows a trusted home Wi-Fi (ALLOW_LAN_WITHOUT_PIN=true).
const lanWithoutPin = process.env.ALLOW_LAN_WITHOUT_PIN === "true";
const host = process.env.APP_ACCESS_PIN?.trim() || lanWithoutPin ? process.env.HOST || "0.0.0.0" : "127.0.0.1";
if (lanWithoutPin && !process.env.APP_ACCESS_PIN?.trim()) {
  // eslint-disable-next-line no-console
  console.warn("[security] No PIN, open to everyone on this network (ALLOW_LAN_WITHOUT_PIN=true). Never use on a public network.");
}

app.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`Vice Principal AI server listening on http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
  startMorningListScheduler();
  startReminderScheduler();
  startDailyJobs();
});
