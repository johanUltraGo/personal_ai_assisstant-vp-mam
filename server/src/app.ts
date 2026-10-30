import express from "express";
import path from "path";
import { tasksRouter } from "./routes/tasks";
import { morningListRouter } from "./routes/morningList";
import { remindersRouter } from "./routes/reminders";
import { aiRouter } from "./routes/ai";
import { messagingRouter } from "./routes/messaging";
import { calendarRouter } from "./routes/calendar";

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use("/api/tasks", tasksRouter);
  app.use("/api/morning-list", morningListRouter);
  app.use("/api/reminders", remindersRouter);
  app.use("/api/ai", aiRouter);
  app.use("/api/messaging", messagingRouter);
  app.use("/api/calendar", calendarRouter);

  // Minimal functional web UI (stand-in secondary screen until the
  // native Android client is built for Phase 4's power-button goal —
  // see planning.md §4.1). Real, working, not a mockup: it talks to the
  // same REST API above.
  app.use("/", express.static(path.join(__dirname, "..", "public")));

  return app;
}
