import { Contact, MessageSent, PendingMessage } from "@prisma/client";
import { prisma } from "../db";
import * as contactService from "./contactService";
import { GmailConnector } from "../connectors/gmailConnector";
import { WhatsAppConnector, WhatsAppWindowError, whatsappHandoffUrl } from "../connectors/whatsappConnector";
import { ConnectorNotConfiguredError } from "../connectors/connector";
import { BadRequestError, NotFoundError } from "../http/errors";
import { logActivity } from "./activityService";

/** How long a shown "Send?" preview stays sendable (design §4). */
export const PENDING_TTL_MS = 30 * 60_000;

export type RecipientResolution =
  | { status: "resolved"; contact: Contact }
  | { status: "ambiguous"; matches: Contact[] }
  | { status: "not_found" };

/** Spec §5: "she says a contact's name ... if several contacts match, it asks which one." */
export async function resolveRecipient(name: string): Promise<RecipientResolution> {
  const matches = await contactService.findContactsByName(name);
  if (matches.length === 1) return { status: "resolved", contact: matches[0] };
  if (matches.length > 1) return { status: "ambiguous", matches };
  return { status: "not_found" };
}

export type MessageChannel = "EMAIL" | "WHATSAPP";

export interface PrepareInput {
  contactId: string;
  channel: MessageChannel;
  subject?: string;
  body: string;
  calendarEventId?: string;
}

/**
 * Stores exactly what she will be shown with the single "Send?" question
 * (spec §5). Nothing is sent here; only sendPending can send, and only this
 * stored row.
 */
export async function prepareMessage(input: PrepareInput): Promise<PendingMessage> {
  const contact = await prisma.contact.findUnique({ where: { id: input.contactId } });
  if (!contact) throw new NotFoundError("That contact no longer exists.");
  if (!input.body.trim()) throw new BadRequestError("The message is empty.");

  let address: string | null;
  if (input.channel === "EMAIL") {
    if (!contact.email) throw new BadRequestError(`${contact.displayName} has no email address on file.`);
    address = contact.email;
  } else {
    // Groups have no number: WhatsApp opens its chat picker so she chooses the group.
    address = contact.kind === "GROUP" ? null : contact.whatsappNumber;
  }

  const pending = await prisma.pendingMessage.create({
    data: {
      channel: input.channel,
      contactId: contact.id,
      recipientName: contact.displayName,
      recipientKind: contact.kind,
      recipientAddress: address,
      subject: input.subject?.trim() || null,
      body: input.body,
      calendarEventId: input.calendarEventId,
      expiresAt: new Date(Date.now() + PENDING_TTL_MS),
    },
  });
  await logActivity("message.prepared", `Prepared a ${channelName(input.channel)} to ${contact.displayName} for you to approve.`, {
    type: "PendingMessage",
    id: pending.id,
  });
  return pending;
}

export interface MessagingConnectors {
  gmail: GmailConnector;
  whatsapp: WhatsAppConnector;
}

export interface SendResult {
  status: "SENT" | "FAILED" | "BLOCKED" | "HANDED_OFF";
  handoffUrl?: string;
  record: MessageSent;
}

/**
 * The ONLY function that lets a message leave the system. It sends the stored
 * preview she approved, claims it atomically so a double tap cannot send
 * twice, and records every outcome permanently in MessageSent.
 */
export async function sendPending(id: string, connectors: MessagingConnectors): Promise<SendResult> {
  const claim = await prisma.pendingMessage.updateMany({
    where: { id, usedAt: null, cancelledAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (claim.count === 0) {
    const exists = await prisma.pendingMessage.findUnique({ where: { id } });
    if (!exists) throw new NotFoundError("That message preview no longer exists.");
    throw new BadRequestError("This message was already sent or expired. Please prepare it again.");
  }
  const message = await prisma.pendingMessage.findUniqueOrThrow({ where: { id } });

  let status: SendResult["status"];
  let handoffUrl: string | undefined;
  let blockReason: string | undefined;
  let fromAccount: string | undefined;

  try {
    if (message.channel === "EMAIL") {
      await connectors.gmail.send({ to: message.recipientAddress!, subject: message.subject ?? "", body: message.body });
      fromAccount = connectors.gmail.accountLabel;
      status = "SENT";
    } else if (message.recipientKind === "PERSON" && message.recipientAddress && connectors.whatsapp.apiConfigured) {
      await connectors.whatsapp.send({ to: message.recipientAddress, body: message.body });
      status = "SENT";
    } else {
      handoffUrl = whatsappHandoffUrl(message.recipientAddress, message.body);
      status = "HANDED_OFF";
    }
  } catch (err) {
    blockReason = (err as Error).message;
    if (err instanceof ConnectorNotConfiguredError) {
      status = "BLOCKED";
    } else {
      status = "FAILED";
      if (err instanceof WhatsAppWindowError) {
        handoffUrl = whatsappHandoffUrl(message.recipientAddress, message.body);
        blockReason += " You can send it yourself in WhatsApp instead.";
      }
    }
  }

  const record = await prisma.messageSent.create({
    data: {
      channel: message.channel,
      recipient: message.recipientAddress ?? message.recipientName,
      subject: message.subject,
      body: message.body,
      status,
      blockReason,
      pendingMessageId: message.id,
      fromAccount,
      handoffUrl,
    },
  });

  if ((status === "SENT" || status === "HANDED_OFF") && message.calendarEventId) {
    await prisma.calendarEvent.updateMany({
      where: { id: message.calendarEventId },
      data: { notifiedAt: new Date(), decision: "APPROVED", decidedAt: new Date() },
    });
  }

  const what = `${channelName(message.channel)} to ${message.recipientName}`;
  const summary = {
    SENT: `Sent the ${what} you approved.`,
    HANDED_OFF: `Opened WhatsApp with the message to ${message.recipientName} ready for you to send.`,
    BLOCKED: `Could not send the ${what}: ${blockReason}`,
    FAILED: `Sending the ${what} failed: ${blockReason}`,
  }[status];
  await logActivity(`message.${status.toLowerCase()}`, summary, { type: "MessageSent", id: record.id });

  return { status, handoffUrl, record };
}

export async function cancelPending(id: string) {
  const claim = await prisma.pendingMessage.updateMany({ where: { id, usedAt: null, cancelledAt: null }, data: { cancelledAt: new Date() } });
  if (claim.count === 0) {
    if (!(await prisma.pendingMessage.findUnique({ where: { id } }))) throw new NotFoundError("That message preview no longer exists.");
  }
  return prisma.pendingMessage.findUniqueOrThrow({ where: { id } });
}

export function listSent(limit = 50) {
  return prisma.messageSent.findMany({ orderBy: { confirmedAt: "desc" }, take: limit });
}

function channelName(channel: string) {
  return channel === "EMAIL" ? "email" : "WhatsApp message";
}
