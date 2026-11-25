/**
 * Automatic SMS. Pluggable with SMS_PROVIDER:
 * - "smsgate" (now): "SMS Gateway for Android" (sms-gate.app) on an Android
 *   phone with a SIM, in cloud mode. The phone sends real SMS from its SIM, so
 *   it is free within the SIM's SMS plan, to any number.
 * Add another provider as a class here plus a case in smsSenderFromEnvironment.
 * Without a provider, SMS to people stays tap-to-send (the Messages app opens).
 */
export interface SmsSender {
  readonly provider: string;
  send(to: string, text: string): Promise<void>;
}

/** Indian 10-digit numbers get +91; others must already include the country code. */
export function internationalNumber(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (/^\d{10}$/.test(digits)) return `+91${digits}`;
  return `+${digits}`;
}

export class SmsGateSender implements SmsSender {
  readonly provider = "smsgate";

  constructor(
    private readonly username: string,
    private readonly password: string,
    private readonly baseUrl = "https://api.sms-gate.app/3rdparty/v1",
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async send(to: string, text: string): Promise<void> {
    const response = await this.fetchImpl(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.username}:${this.password}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ textMessage: { text }, phoneNumbers: [internationalNumber(to)] }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 200);
      throw new Error(`The SMS gateway phone did not accept the message (${response.status}): ${detail}`);
    }
  }
}

export function smsSenderFromEnvironment(): SmsSender | null {
  const provider = (process.env.SMS_PROVIDER || "smsgate").toLowerCase();
  if (provider === "smsgate") {
    const user = process.env.SMSGATE_USERNAME?.trim();
    const pass = process.env.SMSGATE_PASSWORD?.trim();
    return user && pass ? new SmsGateSender(user, pass, process.env.SMSGATE_URL?.trim() || undefined) : null;
  }
  return null;
}
