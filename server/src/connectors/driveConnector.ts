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
