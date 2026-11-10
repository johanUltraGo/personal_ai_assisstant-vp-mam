import { prisma } from "../db";
import { GmailApiClient, GmailConnector, gmailFromEnvironment } from "./gmailConnector";
import { DriveClient, DriveConnector, DriveFile, GoogleDriveApiClient, driveFromEnvironment } from "./driveConnector";
import { whatsappFromEnvironment } from "./whatsappConnector";
import { accessTokenFor } from "../google/accounts";
import { MessagingConnectors } from "../services/messagingService";

/** Gmail sends from the default connected Google account; the legacy
 * GOOGLE_ACCESS_TOKEN is used only when no account is connected. */
export async function gmailConnector(): Promise<GmailConnector> {
  const account = await prisma.googleAccount.findFirst({ orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
  if (!account) return gmailFromEnvironment();
  return new GmailConnector(account.email, new GmailApiClient(() => accessTokenFor(account.id)));
}

/** Drive tries the default account first, then each other account, so a
 * file shared to the school account is still found. */
class MultiAccountDriveClient implements DriveClient {
  constructor(private readonly clients: DriveClient[]) {}

  async readFile(fileId: string): Promise<DriveFile> {
    let lastError: unknown;
    for (const client of this.clients) {
      try {
        return await client.readFile(fileId);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  }
}

export async function driveConnector(): Promise<DriveConnector> {
  const accounts = await prisma.googleAccount.findMany({ orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
  if (!accounts.length) return driveFromEnvironment();
  const clients = accounts.map((a) => new GoogleDriveApiClient(() => accessTokenFor(a.id)));
  return new DriveConnector(accounts.map((a) => a.email).join(", "), new MultiAccountDriveClient(clients));
}

export async function messagingConnectors(): Promise<MessagingConnectors> {
  return { gmail: await gmailConnector(), whatsapp: whatsappFromEnvironment() };
}
