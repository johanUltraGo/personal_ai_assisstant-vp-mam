import express from "express";
import path from "path";
import { tasksRouter } from "./routes/tasks";
import { morningListRouter } from "./routes/morningList";
import { remindersRouter } from "./routes/reminders";
import { messagingRouter } from "./routes/messaging";
import { calendarRouter } from "./routes/calendar";
import { leaveRouter } from "./routes/leave";
import { connectorsRouter } from "./routes/connectors";
import { attachmentsRouter } from "./routes/attachments";
import { errorHandler } from "./http/errors";
import { authRouter, requireAccess } from "./http/auth";
import { activityRouter } from "./routes/activity";
import { googleRouter } from "./routes/google";
import { assistantRouter } from "./routes/assistant";
import { plansRouter } from "./routes/plans";
import { pushRouter } from "./routes/push";

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use("/api/auth", authRouter);
  app.use("/api", requireAccess);

  app.use("/api/tasks", tasksRouter);
  app.use("/api/morning-list", morningListRouter);
  app.use("/api/reminders", remindersRouter);
  app.use("/api/messaging", messagingRouter);
  app.use("/api/calendar", calendarRouter);
  app.use("/api/leave", leaveRouter);
  app.use("/api/connectors", connectorsRouter);
  app.use("/api/attachments", attachmentsRouter);
  app.use("/api/activity", activityRouter);
  app.use("/api/google", googleRouter);
  app.use("/api/assistant", assistantRouter);
  app.use("/api/plans", plansRouter);
  app.use("/api/push", pushRouter);

  // Minimal functional web UI (stand-in secondary screen until the
  // native Android client is built for Phase 4's power-button goal —
  // see planning.md §4.1). Real, working, not a mockup: it talks to the
  // same REST API above.
  app.use("/", express.static(path.join(__dirname, "..", "public")));

  app.use(errorHandler);
  return app;
}
