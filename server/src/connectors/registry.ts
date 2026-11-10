import { gmailFromEnvironment } from "./gmailConnector";
import { whatsappFromEnvironment } from "./whatsappConnector";
import { MessagingConnectors } from "../services/messagingService";

/** The connectors a send uses right now. One place to change when accounts are added. */
export async function messagingConnectors(): Promise<MessagingConnectors> {
  return { gmail: gmailFromEnvironment(), whatsapp: whatsappFromEnvironment() };
}
