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

describe("reminders go where she asked", () => {
  const make = () => {
    const emails: any[] = [];
    const wa: string[] = [];
    const pushes: any[] = [];
    const gmail = new GmailConnector("vp@school.edu", { send: async (e) => { emails.push(e); return { id: "1" }; } });
    const phone = { confirmsDelivery: false, send: async (p: any) => { pushes.push(p); return true; } };
    const whatsapp = { provider: "test", send: async (t: string) => { wa.push(t); } };
    return { emails, wa, pushes, n: new EmailAlsoNotifier(phone, async () => gmail, "vp@school.edu", whatsapp) };
  };

  it("WhatsApp reminder: WhatsApp to her number plus a Gmail copy, no phone push", async () => {
    const t = make();
    expect(await t.n.send({ title: "Reminder", body: "call transport", data: { channel: "WHATSAPP" } })).toBe(true);
    expect(t.wa).toEqual(["Reminder: call transport"]);
    expect(t.emails).toHaveLength(1);
    expect(t.pushes).toHaveLength(0);
    expect(t.n.confirmsDelivery).toBe(true);
  });

  it("Gmail reminder: email only", async () => {
    const t = make();
    await t.n.send({ title: "Reminder", body: "x", data: { channel: "EMAIL" } });
    expect(t.emails).toHaveLength(1);
    expect(t.wa).toHaveLength(0);
    expect(t.pushes).toHaveLength(0);
  });

  it("Phone-only reminder: no email, no WhatsApp", async () => {
    const t = make();
    await t.n.send({ title: "Reminder", body: "x", data: { channel: "PHONE" } });
    expect(t.pushes).toHaveLength(1);
    expect(t.emails).toHaveLength(0);
    expect(t.wa).toHaveLength(0);
  });
});

describe("CallMeBot", () => {
  it("calls the API with her number, the text and the key", async () => {
    const { CallMeBotWhatsApp } = await import("../src/connectors/whatsappSelf");
    let url = "";
    const fake = (async (u: string) => { url = u; return new Response("Message queued. You will receive it in a few seconds.", { status: 200 }); }) as any;
    await new CallMeBotWhatsApp("+91 98765 43210", "123456", fake).send("Reminder: hi");
    expect(url).toContain("phone=%2B919876543210");
    expect(url).toContain("apikey=123456");
    expect(url).toContain("text=Reminder%3A+hi");
  });

  it("throws when CallMeBot reports a bad key", async () => {
    const { CallMeBotWhatsApp } = await import("../src/connectors/whatsappSelf");
    const fake = (async () => new Response("APIKey is not valid", { status: 200 })) as any;
    await expect(new CallMeBotWhatsApp("+91", "x", fake).send("hi")).rejects.toThrow(/did not send/);
  });
});

describe("WhatsApp via Meta", () => {
  it("sends the approved reminder template to her number", async () => {
    const { MetaWhatsApp } = await import("../src/connectors/whatsappSelf");
    let req: any;
    const fake = (async (url: string, init: any) => { req = { url, ...init }; return new Response("{}", { status: 200 }); }) as any;
    await new MetaWhatsApp("+91 98765 43210", "tok", "12345", "vp_reminder", "en", fake).send("Reminder: call\ntransport");
    expect(req.url).toBe("https://graph.facebook.com/v21.0/12345/messages");
    expect(req.headers.Authorization).toBe("Bearer tok");
    const body = JSON.parse(req.body);
    expect(body.to).toBe("919876543210");
    expect(body.template).toEqual({ name: "vp_reminder", language: { code: "en" }, components: [{ type: "body", parameters: [{ type: "text", text: "Reminder: call transport" }] }] });
  });

  it("reports Meta's error", async () => {
    const { MetaWhatsApp } = await import("../src/connectors/whatsappSelf");
    const fake = (async () => new Response('{"error":{"message":"Template not approved"}}', { status: 400 })) as any;
    await expect(new MetaWhatsApp("+91", "t", "1", "vp_reminder", "en", fake).send("x")).rejects.toThrow(/Template not approved/);
  });
});
