import { prisma } from "../db";
import { GmailApiClient, GmailConnector, gmailFromEnvironment } from "./gmailConnector";
import { DriveClient, DriveConnector, DriveFile, DriveSearchHit, GoogleDriveApiClient, driveFromEnvironment } from "./driveConnector";
import { whatsappFromEnvironment } from "./whatsappConnector";
import { smsSenderFromEnvironment } from "./smsSender";
import { accessTokenFor } from "../google/accounts";
import { serviceAccountAccessToken, serviceAccountKey } from "../google/serviceAccount";
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

  /** Every account is searched; the same file seen twice is listed once. */
  async search(query: string, limit: number): Promise<DriveSearchHit[]> {
    const seen = new Map<string, DriveSearchHit>();
    let failures = 0;
    for (const client of this.clients) {
      try {
        for (const hit of (await client.search?.(query, limit)) ?? []) if (!seen.has(hit.id)) seen.set(hit.id, hit);
      } catch {
        failures++;
      }
    }
    if (failures === this.clients.length && failures > 0) throw new Error("Drive search failed for every connected account.");
    return [...seen.values()].slice(0, limit);
  }
}

/** Drive readers: the service account first (files shared with its email,
 * e.g. the school calendar), then each connected Google account. */
export async function driveConnector(): Promise<DriveConnector> {
  const accounts = await prisma.googleAccount.findMany({ orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
  const robot = serviceAccountKey();
  if (!accounts.length && !robot) return driveFromEnvironment();
  const clients: DriveClient[] = [];
  const names: string[] = [];
  if (robot) {
    clients.push(new GoogleDriveApiClient(() => serviceAccountAccessToken(robot)));
    names.push(robot.client_email);
  }
  for (const a of accounts) {
    clients.push(new GoogleDriveApiClient(() => accessTokenFor(a.id)));
    names.push(a.email);
  }
  return new DriveConnector(names.join(", "), new MultiAccountDriveClient(clients));
}

export async function messagingConnectors(): Promise<MessagingConnectors> {
  return { gmail: await gmailConnector(), whatsapp: whatsappFromEnvironment(), sms: smsSenderFromEnvironment() };
}
