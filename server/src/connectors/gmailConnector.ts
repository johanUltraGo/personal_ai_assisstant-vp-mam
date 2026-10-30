import { Connector, ConnectorHealth, ConnectorNotConfiguredError } from "./connector";

export interface OutboundEmail {
  to: string;
  subject: string;
  body: string;
}

/** Thin seam over whatever Gmail client actually sends the mail — lets
 * tests exercise GmailConnector's logic without a real Google API call. */
export interface EmailClient {
  send(email: OutboundEmail): Promise<{ id: string }>;
}

/**
 * Gmail connector (spec §7: "multiple accounts, full access"). Real
 * sending requires a Google OAuth client (GOOGLE_OAUTH_CLIENT_ID/SECRET)
 * plus a completed per-account consent flow — neither exists in this
 * environment, so this connector is implemented and unit-testable via
 * an injected EmailClient, but reports itself unconfigured and refuses
 * to send until a real client is wired in. This is a deliberate blocker,
 * not a bug: see planning.md §7 and the final report's blocker list.
 */
export class GmailConnector implements Connector {
  readonly type = "gmail";

  constructor(private readonly accountLabel: string, private readonly client?: EmailClient) {}

  health(): ConnectorHealth {
    if (this.client) {
      return { configured: true, detail: `Gmail connector ready for account "${this.accountLabel}"` };
    }
    return {
      configured: false,
      detail: `Gmail account "${this.accountLabel}" has no OAuth client configured (GOOGLE_OAUTH_CLIENT_ID/SECRET + per-account consent required).`,
    };
  }

  async send(email: OutboundEmail): Promise<{ id: string }> {
    if (!this.client) {
      throw new ConnectorNotConfiguredError(
        `Cannot send: Gmail account "${this.accountLabel}" is not connected. Complete Google OAuth setup first.`
      );
    }
    return this.client.send(email);
  }
}
