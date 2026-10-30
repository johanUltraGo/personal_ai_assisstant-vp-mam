import "dotenv/config";
import { createApp } from "./app";
import { start as startMorningListScheduler } from "./scheduler/morningListScheduler";
import { start as startReminderScheduler } from "./scheduler/reminderScheduler";

const port = Number(process.env.PORT) || 4000;
const app = createApp();

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Vice Principal AI server listening on http://localhost:${port}`);
  startMorningListScheduler();
  startReminderScheduler();
});
