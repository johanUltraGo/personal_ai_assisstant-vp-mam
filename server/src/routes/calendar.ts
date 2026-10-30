import { Router } from "express";
import { z } from "zod";
import * as calendarService from "../services/calendarService";
import * as messagingService from "../services/messagingService";
import { GmailConnector } from "../connectors/gmailConnector";
import { WhatsAppConnector } from "../connectors/whatsappConnector";

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

calendarRouter.get("/due-prompts", async (_req, res) => {
  res.json(await calendarService.findEventsNeedingPrompt());
});

const respondSchema = z.object({
  approved: z.boolean(),
  // Required only when approved — which contact ("the parents' group")
  // to notify. Not hardcoded, since the spec doesn't define how that
  // group is represented; the caller must already have that contact.
  contactId: z.string().optional(),
  subject: z.string().optional(),
  body: z.string().optional(),
});

/** Her answer to "Shall I send a notification to the parents' group?"
 * (spec §6). On approval, this reuses the exact same prepare+confirm
 * send path as every other message — there is no separate, looser send
 * path for calendar notifications. */
calendarRouter.post("/events/:id/respond", async (req, res) => {
  const parsed = respondSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  if (!parsed.data.approved) {
    const updated = await calendarService.recordDecision(req.params.id, false);
    return res.json({ event: updated, message: null });
  }

  if (!parsed.data.contactId || !parsed.data.body) {
    return res.status(400).json({ error: "contactId and body are required when approved is true" });
  }

  try {
    const prepared = await messagingService.prepareMessage({
      contactId: parsed.data.contactId,
      channel: "EMAIL",
      subject: parsed.data.subject,
      body: parsed.data.body,
    });
    const sent = await messagingService.confirmSend(prepared, {
      gmail: new GmailConnector("default"),
      whatsapp: new WhatsAppConnector(),
    });
    const updated = await calendarService.recordDecision(req.params.id, (sent as any).status === "SENT");
    res.json({ event: updated, message: sent });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
