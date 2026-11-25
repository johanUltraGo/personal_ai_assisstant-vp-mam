import { Router, Request } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { DateTime } from "luxon";
import { prisma } from "../db";
import { runTurn, startConversation } from "../assistant/agent";
import { schoolTimezone } from "../services/morningListService";
import { logActivity } from "../services/activityService";

/**
 * Two-way WhatsApp: Meta forwards her messages here; the same assistant
 * (calendar, tasks, reminders, Drive) answers in the chat. Only messages from
 * her own number (VP_WHATSAPP_NUMBER) are answered, and only when Meta's
 * signature (META_APP_SECRET) checks out. Messages to other people still
 * need her Send tap in the app.
 */
export const whatsappWebhookRouter = Router();

const digits = (s: string | undefined) => (s ?? "").replace(/\D/g, "");

whatsappWebhookRouter.get("/", (req, res) => {
  const token = process.env.META_WA_VERIFY_TOKEN?.trim();
  if (token && req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === token) {
    return res.status(200).send(String(req.query["hub.challenge"] ?? ""));
  }
  res.sendStatus(403);
});

function signatureOk(req: Request & { rawBody?: Buffer }): boolean {
  const secret = process.env.META_APP_SECRET?.trim();
  const header = String(req.headers["x-hub-signature-256"] ?? "");
  if (!secret || !req.rawBody || !header.startsWith("sha256=")) return false;
  const expected = Buffer.from("sha256=" + createHmac("sha256", secret).update(req.rawBody).digest("hex"));
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** One conversation per day, so she can follow up ("and tomorrow?"). */
async function todaysConversation(): Promise<string> {
  const start = DateTime.now().setZone(schoolTimezone()).startOf("day").toJSDate();
  const row = await prisma.activityLog.findFirst({ where: { kind: "whatsapp.conversation", at: { gte: start } }, orderBy: { at: "desc" } });
  if (row?.refId) return row.refId;
  const conversation = await startConversation("GENERAL");
  await logActivity("whatsapp.conversation", "Started today's WhatsApp chat with the assistant.", { type: "conversation", id: conversation.id });
  return conversation.id;
}

export async function sendWhatsAppText(to: string, body: string) {
  const token = process.env.META_WA_TOKEN?.trim();
  const phoneId = process.env.META_WA_PHONE_NUMBER_ID?.trim();
  if (!token || !phoneId) throw new Error("WhatsApp (Meta) is not set up.");
  for (let i = 0; i < body.length; i += 4000) {
    const response = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(phoneId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: digits(to), type: "text", text: { body: body.slice(i, i + 4000) } }),
    });
    if (!response.ok) throw new Error(`WhatsApp reply failed: ${(await response.text()).slice(0, 200)}`);
  }
}

/** Markdown **bold** becomes WhatsApp *bold*. */
const forWhatsApp = (text: string) => text.replace(/\*\*(.+?)\*\*/g, "*$1*");

whatsappWebhookRouter.post("/", async (req, res) => {
  if (!signatureOk(req)) return res.sendStatus(401);
  const her = digits(process.env.VP_WHATSAPP_NUMBER);
  const messages: any[] = (req.body?.entry ?? []).flatMap((e: any) => (e.changes ?? []).flatMap((c: any) => c.value?.messages ?? []));
  for (const message of messages) {
    if (!her || digits(message.from) !== her) continue;
    // Meta may deliver the same message twice: answer once.
    if (await prisma.activityLog.findFirst({ where: { kind: "whatsapp.in", refId: String(message.id) } })) continue;
    await logActivity("whatsapp.in", "Message from you on WhatsApp.", { type: "whatsapp", id: String(message.id) });
    try {
      if (message.type !== "text" || !message.text?.body) {
        await sendWhatsAppText(her, "For now I can read typed messages only. Please type it, or use the voice page in the app.");
        continue;
      }
      const result = await runTurn(await todaysConversation(), message.text.body, "TYPED");
      let reply = forWhatsApp(result.reply);
      if (result.cards.some((c) => c.type === "send")) {
        const origin = process.env.PUBLIC_ORIGIN?.trim();
        reply += `\n\nThe message is ready but not sent. Open the app to check it and tap Send${origin ? `: ${origin}` : "."}`;
      }
      await sendWhatsAppText(her, reply);
    } catch (err) {
      console.error("[whatsapp] reply failed:", err);
      await sendWhatsAppText(her, "Sorry, something went wrong. Please try again in a minute.").catch(() => undefined);
    }
  }
  res.sendStatus(200);
});
