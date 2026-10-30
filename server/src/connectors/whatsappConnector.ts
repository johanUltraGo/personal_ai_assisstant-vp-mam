import { Connector, ConnectorHealth, ConnectorNotConfiguredError } from "./connector";

/**
 * WhatsApp is listed in the registry (so the plug-in architecture
 * requirement — spec §7 — covers it) but is NOT implemented for real
 * sending. Per planning.md §11.2 item 14: there is no general,
 * compliant way for a third-party assistant to send from a personal
 * WhatsApp account. The only legitimate path is the paid WhatsApp
 * Business Platform via an approved provider, which requires a
 * business decision and account setup this project does not have.
 * `health()` always reports unconfigured with that explanation;
 * `send()` always throws. This is intentional, not a stub to "finish
 * later" silently — it needs her decision first (see final report).
 */
export class WhatsAppConnector implements Connector {
  readonly type = "whatsapp";

  health(): ConnectorHealth {
    return {
      configured: false,
      detail:
        "WhatsApp sending is not implemented: no compliant automated-sending path has been " +
        "confirmed (see planning.md §11.2 #14 — requires a decision on the paid WhatsApp " +
        "Business Platform vs. not building this feature).",
    };
  }

  async send(): Promise<never> {
    throw new ConnectorNotConfiguredError(
      "WhatsApp sending is blocked pending a decision on the WhatsApp Business Platform (see planning.md §11.2 #14)."
    );
  }
}
