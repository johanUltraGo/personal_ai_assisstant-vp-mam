import { Connector, ConnectorHealth, ConnectorNotConfiguredError } from "./connector";

export interface DriveFile {
  name: string;
  content: string;
}

/** Thin seam over the real Google Drive client, for the same reason as
 * EmailClient in gmailConnector.ts. */
export interface DriveClient {
  readFile(fileId: string): Promise<DriveFile>;
}

class GoogleDriveApiClient implements DriveClient {
  constructor(private readonly accessToken: string) {}

  async readFile(fileId: string): Promise<DriveFile> {
    const headers = { Authorization: `Bearer ${this.accessToken}` };
    const metadataResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=name,mimeType`,
      { headers }
    );
    if (!metadataResponse.ok) throw new Error(`Drive could not read file details (${metadataResponse.status}): ${await metadataResponse.text()}`);
    const metadata = (await metadataResponse.json()) as { name: string; mimeType: string };
    const isGoogleDocument = metadata.mimeType.startsWith("application/vnd.google-apps.");
    const contentUrl = isGoogleDocument
      ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=text/plain`
      : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
    const contentResponse = await fetch(contentUrl, { headers });
    if (!contentResponse.ok) throw new Error(`Drive could not download the file (${contentResponse.status}): ${await contentResponse.text()}`);
    return { name: metadata.name, content: await contentResponse.text() };
  }
}

/**
 * Google Drive connector (spec §7: "multiple accounts, full access,
 * including the school Drive"). Same blocker as Gmail: no OAuth client
 * credentials exist in this environment, so real reads are not
 * possible yet. The "read the whole file, then summarize it to her"
 * behaviour (spec §5) is implemented in readAndSummarize below and is
 * fully unit-testable against an injected DriveClient.
 */
export class DriveConnector implements Connector {
  readonly type = "drive";

  constructor(private readonly accountLabel: string, private readonly client?: DriveClient) {}

  health(): ConnectorHealth {
    if (this.client) {
      return { configured: true, detail: `Drive connector ready for account "${this.accountLabel}"` };
    }
    return {
      configured: false,
      detail: `Drive account "${this.accountLabel}" has no OAuth client configured (GOOGLE_OAUTH_CLIENT_ID/SECRET + per-account consent required, and separately, school Drive permission must be granted — planning.md §7).`,
    };
  }

  async readFile(fileId: string): Promise<DriveFile> {
    if (!this.client) {
      throw new ConnectorNotConfiguredError(
        `Cannot read: Drive account "${this.accountLabel}" is not connected. Complete Google OAuth setup first.`
      );
    }
    return this.client.readFile(fileId);
  }
}

/**
 * Reads a whole Drive file and produces the text she should be told
 * before she dictates anything to send (spec §5: read-then-summarize,
 * strictly before any send). The actual summarization wording here is
 * a placeholder pass-through, not a Claude call, since this function's
 * job is the *ordering guarantee* (read fully, then and only then allow
 * a send) — wiring this summary through aiTaskParser's Claude client is
 * a natural follow-up once Drive access itself is unblocked.
 */
export async function readAndSummarize(connector: DriveConnector, fileId: string): Promise<string> {
  const file = await connector.readFile(fileId);
  return `"${file.name}" contains: ${file.content}`;
}

export function driveFromEnvironment(accountLabel = process.env.DRIVE_ACCOUNT_LABEL || "default") {
  const accessToken = process.env.GOOGLE_ACCESS_TOKEN;
  return new DriveConnector(accountLabel, accessToken ? new GoogleDriveApiClient(accessToken) : undefined);
}
