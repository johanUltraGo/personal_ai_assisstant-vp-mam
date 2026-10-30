import { Router } from "express";
import { z } from "zod";
import * as reminderService from "../services/reminderService";
import { prisma } from "../db";

export const remindersRouter = Router();

const createReminderSchema = z.object({
  label: z.string().min(1),
  fireAt: z.coerce.date(),
  taskId: z.string().optional(),
  repeatRule: z.enum(["DAILY", "WEEKLY"]).optional(),
});

/** On-demand only — there is no endpoint that creates a reminder
 * automatically for every task (spec §3: "no automatic reminder for
 * every task"). This route only fires when something — ultimately her,
 * via the client — explicitly calls it with a time she chose. */
remindersRouter.post("/", async (req, res) => {
  const parsed = createReminderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const reminder = await reminderService.createReminder(parsed.data);
  res.status(201).json(reminder);
});

remindersRouter.get("/", async (_req, res) => {
  const reminders = await prisma.reminder.findMany({ orderBy: { fireAt: "asc" } });
  res.json(reminders);
});

remindersRouter.get("/:id", async (req, res) => {
  try {
    const reminder = await prisma.reminder.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { log: { orderBy: { eventAt: "asc" } } },
    });
    res.json(reminder);
  } catch {
    res.status(404).json({ error: "Reminder not found" });
  }
});

const minutesSchema = z.object({ minutes: z.number().int().positive() });

remindersRouter.post("/:id/snooze", async (req, res) => {
  const parsed = minutesSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const updated = await reminderService.snooze(req.params.id, parsed.data.minutes);
  res.json(updated);
});

remindersRouter.post("/:id/delay", async (req, res) => {
  const parsed = minutesSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const updated = await reminderService.delay(req.params.id, parsed.data.minutes);
  res.json(updated);
});

const rescheduleSchema = z.object({ fireAt: z.coerce.date() });

remindersRouter.post("/:id/reschedule", async (req, res) => {
  const parsed = rescheduleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const updated = await reminderService.reschedule(req.params.id, parsed.data.fireAt);
  res.json(updated);
});
