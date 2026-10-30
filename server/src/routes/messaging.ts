import { Router } from "express";
import { z } from "zod";
import * as contactService from "../services/contactService";
import * as messagingService from "../services/messagingService";
import { GmailConnector } from "../connectors/gmailConnector";
import { WhatsAppConnector } from "../connectors/whatsappConnector";

export const messagingRouter = Router();

const createContactSchema = z.object({
  displayName: z.string().min(1),
  email: z.string().email().optional(),
  whatsappNumber: z.string().optional(),
});

messagingRouter.post("/contacts", async (req, res) => {
  const parsed = createContactSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.status(201).json(await contactService.createContact(parsed.data));
});

messagingRouter.get("/contacts", async (_req, res) => {
  res.json(await contactService.listContacts());
});

messagingRouter.get("/resolve-recipient", async (req, res) => {
  const name = String(req.query.name ?? "");
  if (!name) return res.status(400).json({ error: "name query param is required" });
  res.json(await messagingService.resolveRecipient(name));
});

const prepareSchema = z.object({
  contactId: z.string().min(1),
  channel: z.enum(["EMAIL", "WHATSAPP"]),
  subject: z.string().optional(),
  body: z.string().min(1),
});

/** Returns exactly what the "Send?" prompt should show — does not send. */
messagingRouter.post("/prepare", async (req, res) => {
  const parsed = prepareSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.json(await messagingService.prepareMessage(parsed.data));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

const confirmSendSchema = z.object({
  channel: z.enum(["EMAIL", "WHATSAPP"]),
  recipientContactId: z.string().min(1),
  recipientDisplayName: z.string().min(1),
  recipientAddress: z.string().min(1),
  subject: z.string().optional(),
  body: z.string().min(1),
});

/** The only route that can actually send — takes exactly the
 * PreparedMessage /prepare returned, so the client passes that straight
 * back through once she says yes (spec §5). */
messagingRouter.post("/confirm-send", async (req, res) => {
  const parsed = confirmSendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const connectors = {
    gmail: new GmailConnector("default"), // no OAuth client wired yet — see gmailConnector.ts
    whatsapp: new WhatsAppConnector(),
  };

  try {
    // confirmSend always logs an audit row, even when the connector is
    // not configured (status "BLOCKED") — the client should check
    // result.status rather than relying on the HTTP status for that case.
    const result = await messagingService.confirmSend(parsed.data, connectors);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});
