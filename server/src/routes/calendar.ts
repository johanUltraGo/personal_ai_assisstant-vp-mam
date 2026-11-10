import { Router } from "express";
import { z } from "zod";
import * as calendarService from "../services/calendarService";
import * as messagingService from "../services/messagingService";
import { driveConnector } from "../connectors/registry";

export const calendarRouter = Router();

const seedSchema = z.object({
  eventName: z.string().min(1),
  eventDate: z.coerce.date(),
  type: z.enum(["HOLIDAY", "EVENT"]),
});

/** Stand-in for the real Drive calendar sync (blocked — see
 * driveConnector.ts and the final report). Lets the two-days-before
 * prompt logic be exercised and tested now. */
calendarRouter.post("/events", async (req, res) => {
  const parsed = seedSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.status(201).json(await calendarService.seedEvent(parsed.data));
});

const syncSchema = z.object({ fileId: z.string().min(1) });

/** Downloads the school's shared Drive calendar on demand. OAuth access is checked by the connector. */
calendarRouter.post("/sync-drive", async (req, res) => {
  const parsed = syncSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.json(await calendarService.syncCalendarFromDrive(await driveConnector(), parsed.data.fileId));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

calendarRouter.get("/due-prompts", async (_req, res) => {
  res.json(await calendarService.findEventsNeedingPrompt());
});

const respondSchema = z.object({
  approved: z.boolean(),
  // When approved: which contact ("the parents' group") and the notice text.
  contactId: z.string().optional(),
  channel: z.enum(["EMAIL", "WHATSAPP"]).optional(),
  subject: z.string().optional(),
  body: z.string().optional(),
});

/** Her answer to "Shall I send a notification to the parents' group?" (spec §6).
 * Yes prepares the notice as a normal "Send?" preview; the event is marked
 * notified only when she actually sends it. */
calendarRouter.post("/events/:id/respond", async (req, res) => {
  const parsed = respondSchema.parse(req.body);
  if (!parsed.approved) {
    return res.json({ event: await calendarService.recordDecision(req.params.id, false), pending: null });
  }
  if (!parsed.contactId || !parsed.body) {
    return res.status(400).json({ error: "contactId and body are required when approved is true" });
  }
  const pending = await messagingService.prepareMessage({
    contactId: parsed.contactId,
    channel: parsed.channel ?? "EMAIL",
    subject: parsed.subject,
    body: parsed.body,
    calendarEventId: req.params.id,
  });
  res.json({ event: await calendarService.getEvent(req.params.id), pending });
});
