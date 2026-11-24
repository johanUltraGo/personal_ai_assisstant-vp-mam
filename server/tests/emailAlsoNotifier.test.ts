import { describe, it, expect } from "vitest";
import { EmailAlsoNotifier } from "../src/notifiers/emailAlsoNotifier";
import { GmailConnector } from "../src/connectors/gmailConnector";

const failingPhone = { confirmsDelivery: false, send: async () => false };

describe("reminders also reach her Gmail", () => {
  it("emails the reminder and counts it delivered when the phone push fails", async () => {
    const sent: any[] = [];
    const gmail = new GmailConnector("vp@school.edu", { send: async (e) => { sent.push(e); return { id: "1" }; } });
    const n = new EmailAlsoNotifier(failingPhone, async () => gmail, "vp@school.edu");
    expect(await n.send({ title: "Reminder", body: "hi" })).toBe(true);
    expect(n.confirmsDelivery).toBe(true);
    expect(sent[0]).toMatchObject({ to: "vp@school.edu", subject: "VP Assistant: Reminder" });
  });

  it("reports failure when neither phone nor Gmail works", async () => {
    const n = new EmailAlsoNotifier(failingPhone, async () => new GmailConnector("x"), "vp@school.edu");
    expect(await n.send({ title: "Reminder", body: "hi" })).toBe(false);
  });

  it("skips the email copy when asked", async () => {
    const sent: any[] = [];
    const gmail = new GmailConnector("vp@school.edu", { send: async (e) => { sent.push(e); return { id: "1" }; } });
    const n = new EmailAlsoNotifier(failingPhone, async () => gmail, "vp@school.edu");
    await n.send({ title: "x", body: "y", data: { noEmail: "true" } });
    expect(sent).toHaveLength(0);
  });
});
