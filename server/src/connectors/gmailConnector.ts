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
 * Builds the RFC 2822 message Gmail expects. Subjects are RFC 2047 encoded so
 * Tamil text survives, and line breaks in headers are refused (they would let
 * a crafted address add extra recipients).
 */
export function buildRawEmail(email: OutboundEmail): string {
  if (/[\r\n]/.test(email.to) || /[\r\n]/.test(email.subject)) {
    throw new Error("Email address and subject must be a single line.");
  }
  const subject = /^[\x20-\x7e]*$/.test(email.subject)
    ? email.subject
    : `=?UTF-8?B?${Buffer.from(email.subject, "utf8").toString("base64")}?=`;
  return [
    `To: ${email.to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(email.body, "utf8").toString("base64"),
  ].join("\r\n");
}

export class GmailApiClient implements EmailClient {
  constructor(private readonly accessToken: string | (() => Promise<string>)) {}

  async send(email: OutboundEmail): Promise<{ id: string }> {
    const raw = Buffer.from(buildRawEmail(email), "utf8").toString("base64url");
    const token = typeof this.accessToken === "string" ? this.accessToken : await this.accessToken();
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    if (!response.ok) throw new Error(`Gmail rejected the message (${response.status}): ${await response.text()}`);
    const data = (await response.json()) as { id: string };
    return { id: data.id };
  }
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

  constructor(readonly accountLabel: string, private readonly client?: EmailClient) {}

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

/**
 * Uses a short-lived Google OAuth access token supplied by the deployment.
 * Token acquisition and account consent deliberately remain outside the app;
 * no Google credentials are stored in this repository or database.
 */
export function gmailFromEnvironment(accountLabel = process.env.GMAIL_ACCOUNT_LABEL || "default") {
  const accessToken = process.env.GOOGLE_ACCESS_TOKEN;
  return new GmailConnector(accountLabel, accessToken ? new GmailApiClient(accessToken) : undefined);
}
