import { describe, it, expect } from "vitest";
import * as contactService from "../src/services/contactService";
import * as messagingService from "../src/services/messagingService";
import { GmailConnector, EmailClient } from "../src/connectors/gmailConnector";
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

describe("prepareMessage / confirmSend — single 'Send?' confirmation", () => {
  it("prepares a message preview without sending anything", async () => {
    const contact = await contactService.createContact({ displayName: "Mr. Raman", email: "raman@example.com" });
    const prepared = await messagingService.prepareMessage({
      contactId: contact.id,
      channel: "EMAIL",
      subject: "Leave letter",
      body: "Requesting leave for 2 Nov.",
    });
    expect(prepared.recipientAddress).toBe("raman@example.com");
    expect(await prisma.messageSent.count()).toBe(0);
  });

  it("refuses to prepare a WhatsApp message for a contact with no WhatsApp number", async () => {
    const contact = await contactService.createContact({ displayName: "Mr. No WhatsApp", email: "x@example.com" });
    await expect(
      messagingService.prepareMessage({ contactId: contact.id, channel: "WHATSAPP", body: "Hi" })
    ).rejects.toThrow(/no WhatsApp number/);
  });

  it("sends via Gmail only after confirmSend is called, using the connector it's given", async () => {
    const sent: any[] = [];
    const fakeEmailClient: EmailClient = { send: async (email) => { sent.push(email); return { id: "msg_1" }; } };
    const contact = await contactService.createContact({ displayName: "Mrs. Devi", email: "devi@example.com" });
    const prepared = await messagingService.prepareMessage({ contactId: contact.id, channel: "EMAIL", subject: "Fee reminder", body: "Please submit the fee by Friday." });

    const result = await messagingService.confirmSend(prepared, {
      gmail: new GmailConnector("principal@school.edu", fakeEmailClient),
      whatsapp: new WhatsAppConnector(),
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("devi@example.com");
    expect((result as any).status).toBe("SENT");
  });

  it("logs a BLOCKED audit row instead of sending when Gmail has no OAuth client configured", async () => {
    const contact = await contactService.createContact({ displayName: "Mr. Blocked", email: "blocked@example.com" });
    const prepared = await messagingService.prepareMessage({ contactId: contact.id, channel: "EMAIL", body: "Test" });

    const result = await messagingService.confirmSend(prepared, {
      gmail: new GmailConnector("principal@school.edu"), // no client injected = not configured
      whatsapp: new WhatsAppConnector(),
    });

    expect((result as any).status).toBe("BLOCKED");
    expect((result as any).blockReason).toMatch(/not connected/);
  });

  it("always blocks WhatsApp sends, per the unresolved feasibility question", async () => {
    const contact = await contactService.createContact({ displayName: "Teachers Group Contact", whatsappNumber: "+911234567890" });
    const prepared = await messagingService.prepareMessage({ contactId: contact.id, channel: "WHATSAPP", body: "Leave notice" });

    const result = await messagingService.confirmSend(prepared, {
      gmail: new GmailConnector("principal@school.edu"),
      whatsapp: new WhatsAppConnector(),
    });
    expect((result as any).status).toBe("BLOCKED");
  });
});
