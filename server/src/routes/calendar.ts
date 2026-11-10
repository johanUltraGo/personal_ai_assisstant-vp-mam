import { Router, text } from "express";
import { DateTime } from "luxon";
import { z } from "zod";
import * as calendarService from "../services/calendarService";
import * as messagingService from "../services/messagingService";
import { driveConnector } from "../connectors/registry";
import { driveFileIdFrom } from "../connectors/driveConnector";
import { schoolTimezone } from "../services/morningListService";

export const calendarRouter = Router();

const seedSchema = z.object({
  eventName: z.string().min(1),
  eventDate: z.coerce.date(),
  type: z.enum(["HOLIDAY", "EVENT"]),
});

/** Add one event by hand. */
calendarRouter.post("/events", async (req, res) => {
  res.status(201).json(await calendarService.seedEvent(seedSchema.parse(req.body)));
});

/** Upcoming events and holidays (default: next 60 days). */
calendarRouter.get("/events", async (req, res) => {
  const zone = schoolTimezone();
  const from = req.query.from ? DateTime.fromISO(String(req.query.from), { zone }) : DateTime.now().setZone(zone).startOf("day");
  const to = req.query.to ? DateTime.fromISO(String(req.query.to), { zone }).plus({ days: 1 }) : from.plus({ days: 60 });
  if (!from.isValid || !to.isValid) return res.status(400).json({ error: "from/to must be YYYY-MM-DD" });
  res.json(await calendarService.eventsBetween(from.toJSDate(), to.toJSDate()));
});

/** Upload the calendar file itself (.ics, JSON or CSV) — no Drive needed. */
calendarRouter.post("/import", text({ type: ["text/*", "application/octet-stream"], limit: "2mb" }), async (req, res) => {
  const content = typeof req.body === "string" ? req.body : typeof req.body?.content === "string" ? req.body.content : "";
  if (!content.trim()) return res.status(400).json({ error: "The calendar file is empty." });
  res.json(await calendarService.importCalendar(content));
});

/** Read the school calendar from Drive now: the given file, or SCHOOL_CALENDAR_FILE_ID. */
calendarRouter.post("/sync", async (req, res) => {
  const fileId = typeof req.body?.fileId === "string" && req.body.fileId.trim() ? req.body.fileId : undefined;
  if (fileId) return res.json(await calendarService.syncCalendarFromDrive(await driveConnector(), driveFileIdFrom(fileId)));
  const result = await calendarService.syncConfiguredCalendar();
  if (!result) return res.status(400).json({ error: "No school calendar file is set. Put its Drive link in SCHOOL_CALENDAR_FILE_ID or paste it here." });
  res.json(result);
});

/** Kept for older clients. */
calendarRouter.post("/sync-drive", async (req, res) => {
  const { fileId } = z.object({ fileId: z.string().min(1) }).parse(req.body);
  res.json(await calendarService.syncCalendarFromDrive(await driveConnector(), driveFileIdFrom(fileId)));
});

calendarRouter.get("/due-prompts", async (_req, res) => {
  res.json(await calendarService.findEventsNeedingPrompt());
});

/** Events she was asked about and hasn't answered, each with a ready-made notice. */
calendarRouter.get("/prompts", async (_req, res) => {
  const events = await calendarService.pendingPrompts();
  res.json(events.map((event) => ({ event, draft: calendarService.draftEventNotice(event) })));
});

const respondSchema = z.object({
  approved: z.boolean(),
  contactId: z.string().optional(),
  channel: z.enum(["EMAIL", "WHATSAPP"]).optional(),
  subject: z.string().optional(),
  body: z.string().optional(),
});

/**
 * Her answer to "Shall I send a notification to the parents' group?" (spec §6).
 * No → recorded. Yes without a recipient → the draft notice to edit. Yes with a
 * recipient and text → a normal "Send?" preview; the event counts as notified
 * only once she actually sends it.
 */
calendarRouter.post("/events/:id/respond", async (req, res) => {
  const parsed = respondSchema.parse(req.body);
  if (!parsed.approved) {
    return res.json({ event: await calendarService.recordDecision(req.params.id, false), pending: null });
  }
  const event = await calendarService.getEvent(req.params.id);
  if (!parsed.contactId || !parsed.body) {
    return res.json({ event, draft: calendarService.draftEventNotice(event), pending: null });
  }
  const pending = await messagingService.prepareMessage({
    contactId: parsed.contactId,
    channel: parsed.channel ?? "EMAIL",
    subject: parsed.subject,
    body: parsed.body,
    calendarEventId: event.id,
  });
  res.json({ event, pending });
});
