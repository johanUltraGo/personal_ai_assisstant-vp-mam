import { Router } from "express";
import { z } from "zod";
import * as contactService from "../services/contactService";
import * as messagingService from "../services/messagingService";
import { messagingConnectors } from "../connectors/registry";

export const messagingRouter = Router();

const createContactSchema = z.object({
  displayName: z.string().trim().min(1),
  kind: z.enum(["PERSON", "GROUP"]).optional(),
  email: z.string().email().optional(),
  whatsappNumber: z.string().regex(/^\+?[\d\s-]{6,20}$/, "Use digits with country code, e.g. +91 98765 43210").optional(),
});

messagingRouter.post("/contacts", async (req, res) => {
  res.status(201).json(await contactService.createContact(createContactSchema.parse(req.body)));
});

messagingRouter.get("/contacts", async (_req, res) => {
  res.json(await contactService.listContacts());
});

messagingRouter.delete("/contacts/:id", async (req, res) => {
  res.json(await contactService.deleteContact(req.params.id));
});

messagingRouter.get("/resolve-recipient", async (req, res) => {
  const name = String(req.query.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "name query param is required" });
  res.json(await messagingService.resolveRecipient(name));
});

const prepareSchema = z.object({
  contactId: z.string().min(1),
  channel: z.enum(["EMAIL", "WHATSAPP"]),
  subject: z.string().optional(),
  body: z.string().min(1),
  calendarEventId: z.string().optional(),
});

/** Stores and returns exactly what the "Send?" question shows. Sends nothing. */
messagingRouter.post("/prepare", async (req, res) => {
  res.json(await messagingService.prepareMessage(prepareSchema.parse(req.body)));
});

/** Her "Send" tap. Sends only the stored preview, once (spec §5). */
messagingRouter.post("/pending/:id/send", async (req, res) => {
  res.json(await messagingService.sendPending(req.params.id, await messagingConnectors()));
});

messagingRouter.post("/pending/:id/cancel", async (req, res) => {
  res.json(await messagingService.cancelPending(req.params.id));
});

messagingRouter.get("/sent", async (req, res) => {
  const limit = Number(req.query.limit ?? 50);
  res.json(await messagingService.listSent(Number.isFinite(limit) ? Math.min(limit, 200) : 50));
});
