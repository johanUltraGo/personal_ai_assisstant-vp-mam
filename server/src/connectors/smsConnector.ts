/**
 * SMS, free: no gateway or paid API. The message is handed to the Messages
 * app on her phone with the text typed, and she taps send herself (same
 * pattern as the WhatsApp hand-off).
 */
export function smsHandoffUrl(number: string | null | undefined, body: string): string {
  const digits = (number ?? "").replace(/[^\d+]/g, "");
  return `sms:${digits}?body=${encodeURIComponent(body)}`;
}
