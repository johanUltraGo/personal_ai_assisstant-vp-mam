import { describe, it, expect } from "vitest";
import * as contactService from "../src/services/contactService";
import * as messagingService from "../src/services/messagingService";
import { GmailConnector, EmailClient, buildRawEmail } from "../src/connectors/gmailConnector";
import { WhatsAppConnector } from "../src/connectors/whatsappConnector";
import { prisma } from "../src/db";

describe("resolveRecipient", () => {
  it("resolves a single unambiguous match", async () => {
    await contactService.createContact({ displayName: "Mrs. Lakshmi Iyer", email: "lakshmi@example.com" });
    const result = await messagingService.resolveRecipient("Lakshmi");
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") expect(result.contact.displayName).toBe("Mrs. Lakshmi Iyer");
  });

  it("asks which one when several contacts match the name", async () => {
    await contactService.createContact({ displayName: "Priya Teacher", email: "priya1@example.com" });
    await contactService.createContact({ displayName: "Priya Admin", email: "priya2@example.com" });
    const result = await messagingService.resolveRecipient("priya");
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") expect(result.matches).toHaveLength(2);
  });

  it("reports not_found for no match", async () => {
    const result = await messagingService.resolveRecipient("Nobody Here");
    expect(result.status).toBe("not_found");
  });
});

function fakeGmail(sent: any[]) {
  const client: EmailClient = { send: async (email) => { sent.push(email); return { id: "msg_1" }; } };
  return new GmailConnector("principal@school.edu", client);
}

describe("prepare + sendPending — the server-enforced 'Send?'", () => {
  it("prepares a stored preview without sending anything", async () => {
    const contact = await contactService.createContact({ displayName: "Mr. Raman", email: "raman@example.com" });
    const pending = await messagingService.prepareMessage({ contactId: contact.id, channel: "EMAIL", subject: "Leave letter", body: "Requesting leave for 2 Nov." });
    expect(pending.recipientAddress).toBe("raman@example.com");
    expect(pending.usedAt).toBeNull();
    expect(await prisma.messageSent.count()).toBe(0);
  });

  it("refuses an email to a contact with no email address", async () => {
    const contact = await contactService.createContact({ displayName: "No Email", whatsappNumber: "+919876543210" });
    await expect(messagingService.prepareMessage({ contactId: contact.id, channel: "EMAIL", body: "Hi" })).rejects.toThrow(/no email/);
  });

  it("sends exactly the stored message once; a second Send is refused", async () => {
    const sent: any[] = [];
    const contact = await contactService.createContact({ displayName: "Mrs. Devi", email: "devi@example.com" });
    const pending = await messagingService.prepareMessage({ contactId: contact.id, channel: "EMAIL", subject: "Fee reminder", body: "Please submit the fee by Friday." });
    const connectors = { gmail: fakeGmail(sent), whatsapp: new WhatsAppConnector() };

    const result = await messagingService.sendPending(pending.id, connectors);
    expect(result.status).toBe("SENT");
    await expect(messagingService.sendPending(pending.id, connectors)).rejects.toThrow(/already sent or expired/);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("devi@example.com");
    expect(await prisma.messageSent.count()).toBe(1);
  });

  it("refuses an expired pending message", async () => {
    const sent: any[] = [];
    const contact = await contactService.createContact({ displayName: "Late", email: "late@example.com" });
    const pending = await messagingService.prepareMessage({ contactId: contact.id, channel: "EMAIL", body: "x" });
    await prisma.pendingMessage.update({ where: { id: pending.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(messagingService.sendPending(pending.id, { gmail: fakeGmail(sent), whatsapp: new WhatsAppConnector() })).rejects.toThrow(/already sent or expired/);
    expect(sent).toHaveLength(0);
  });

  it("records BLOCKED when Gmail is not connected", async () => {
    const contact = await contactService.createContact({ displayName: "Mr. Blocked", email: "blocked@example.com" });
    const pending = await messagingService.prepareMessage({ contactId: contact.id, channel: "EMAIL", body: "Test" });
    const result = await messagingService.sendPending(pending.id, { gmail: new GmailConnector("x"), whatsapp: new WhatsAppConnector() });
    expect(result.status).toBe("BLOCKED");
    expect(result.record.blockReason).toMatch(/not connected/);
  });

  it("hands a group WhatsApp message to WhatsApp with the text ready", async () => {
    const group = await contactService.createContact({ displayName: "Teachers group", kind: "GROUP" });
    const pending = await messagingService.prepareMessage({ contactId: group.id, channel: "WHATSAPP", body: "Leave notice" });
    const result = await messagingService.sendPending(pending.id, { gmail: new GmailConnector("x"), whatsapp: new WhatsAppConnector() });
    expect(result.status).toBe("HANDED_OFF");
    expect(result.handoffUrl).toBe("https://wa.me/?text=Leave%20notice");
  });

  it("hands a person's WhatsApp message off when the Business API is not set up", async () => {
    const person = await contactService.createContact({ displayName: "Mr. Arun", whatsappNumber: "+91 98765 43210" });
    const pending = await messagingService.prepareMessage({ contactId: person.id, channel: "WHATSAPP", body: "Hello" });
    const result = await messagingService.sendPending(pending.id, { gmail: new GmailConnector("x"), whatsapp: new WhatsAppConnector() });
    expect(result.handoffUrl).toBe("https://wa.me/919876543210?text=Hello");
  });

  it("uses the Business API for a person when it is configured", async () => {
    const sent: any[] = [];
    const person = await contactService.createContact({ displayName: "Mrs. Rani", whatsappNumber: "+919800000000" });
    const pending = await messagingService.prepareMessage({ contactId: person.id, channel: "WHATSAPP", body: "Hi" });
    const whatsapp = new WhatsAppConnector({ send: async (m) => { sent.push(m); return { id: "wamid" }; } });
    const result = await messagingService.sendPending(pending.id, { gmail: new GmailConnector("x"), whatsapp });
    expect(result.status).toBe("SENT");
    expect(sent[0].to).toBe("+919800000000");
  });

  it("marks a calendar event notified when its notice is sent", async () => {
    const sent: any[] = [];
    const event = await prisma.calendarEvent.create({ data: { eventName: "Diwali", eventDate: new Date("2026-11-12"), type: "HOLIDAY" } });
    const parents = await contactService.createContact({ displayName: "Parents group", kind: "GROUP", email: "parents@school.edu" });
    const pending = await messagingService.prepareMessage({ contactId: parents.id, channel: "EMAIL", body: "Holiday", calendarEventId: event.id });
    await messagingService.sendPending(pending.id, { gmail: fakeGmail(sent), whatsapp: new WhatsAppConnector() });
    const updated = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(updated.notifiedAt).not.toBeNull();
    expect(updated.decision).toBe("APPROVED");
  });
});

describe("Gmail message encoding", () => {
  it("encodes a Tamil subject and refuses header line breaks", () => {
    const raw = buildRawEmail({ to: "a@b.com", subject: "விடுப்பு", body: "x" });
    expect(raw).toContain("Subject: =?UTF-8?B?");
    expect(() => buildRawEmail({ to: "a@b.com\r\nBcc: x@y.com", subject: "s", body: "x" })).toThrow();
  });
});
