import "dotenv/config";
import { createApp } from "./app";
import { start as startMorningListScheduler } from "./scheduler/morningListScheduler";
import { start as startReminderScheduler } from "./scheduler/reminderScheduler";
import { start as startDailyJobs } from "./scheduler/dailyJobs";

const port = Number(process.env.PORT) || 4000;
const app = createApp();

// Without a PIN, listen only on this computer (design §5).
const host = process.env.APP_ACCESS_PIN?.trim() ? process.env.HOST || "0.0.0.0" : "127.0.0.1";

app.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`Vice Principal AI server listening on http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
  startMorningListScheduler();
  startReminderScheduler();
  startDailyJobs();
});
