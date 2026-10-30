import { prisma } from "../db";
import * as contactService from "./contactService";
import { Contact } from "@prisma/client";
import { GmailConnector } from "../connectors/gmailConnector";
import { WhatsAppConnector } from "../connectors/whatsappConnector";
import { ConnectorNotConfiguredError } from "../connectors/connector";

export type RecipientResolution =
  | { status: "resolved"; contact: Contact }
  | { status: "ambiguous"; matches: Contact[] }
  | { status: "not_found" };

/** Spec §5: "she says a contact's name ... if several contacts match,
 * it asks which one." */
export async function resolveRecipient(name: string): Promise<RecipientResolution> {
  const matches = await contactService.findContactsByName(name);
  if (matches.length === 1) return { status: "resolved", contact: matches[0] };
  if (matches.length > 1) return { status: "ambiguous", matches };
  return { status: "not_found" };
}

export type MessageChannel = "EMAIL" | "WHATSAPP";

export interface PreparedMessage {
  channel: MessageChannel;
  recipientContactId: string;
  recipientDisplayName: string;
  recipientAddress: string;
  subject?: string;
  body: string;
}

export class RecipientAddressMissingError extends Error {}

/**
 * Composes exactly what she will be shown before the single "Send?"
 * confirmation (spec §5: "before any message leaves, the assistant
 * shows it once and asks 'Send?'. No other confirmations are asked.").
 * This function only builds that preview — it never sends anything.
 */
export async function prepareMessage(input: {
  contactId: string;
  channel: MessageChannel;
  subject?: string;
  body: string;
}): Promise<PreparedMessage> {
  const contact = await prisma.contact.findUniqueOrThrow({ where: { id: input.contactId } });
  const address = input.channel === "EMAIL" ? contact.email : contact.whatsappNumber;
  if (!address) {
    throw new RecipientAddressMissingError(
      `${contact.displayName} has no ${input.channel === "EMAIL" ? "email" : "WhatsApp number"} on file.`
    );
  }
  return {
    channel: input.channel,
    recipientContactId: contact.id,
    recipientDisplayName: contact.displayName,
    recipientAddress: address,
    subject: input.subject,
    body: input.body,
  };
}

export interface MessagingConnectors {
  gmail: GmailConnector;
  whatsapp: WhatsAppConnector;
}

/**
 * The ONLY function in this codebase that actually sends a message.
 * Called strictly after she has confirmed the exact PreparedMessage
 * from prepareMessage — nothing upstream of this ever sends on its
 * own. Every attempt (success or blocked) is written to MessageSent so
 * there is a permanent record of what went out, or why it didn't.
 */
export async function confirmSend(message: PreparedMessage, connectors: MessagingConnectors) {
  try {
    if (message.channel === "EMAIL") {
      await connectors.gmail.send({
        to: message.recipientAddress,
        subject: message.subject ?? "",
        body: message.body,
      });
    } else {
      await connectors.whatsapp.send();
    }
    return prisma.messageSent.create({
      data: {
        channel: message.channel,
        recipient: message.recipientAddress,
        subject: message.subject,
        body: message.body,
        status: "SENT",
      },
    });
  } catch (err) {
    const blocked = err instanceof ConnectorNotConfiguredError;
    const saved = await prisma.messageSent.create({
      data: {
        channel: message.channel,
        recipient: message.recipientAddress,
        subject: message.subject,
        body: message.body,
        status: blocked ? "BLOCKED" : "FAILED",
        blockReason: (err as Error).message,
      },
    });
    if (blocked) return saved;
    throw err;
  }
}
