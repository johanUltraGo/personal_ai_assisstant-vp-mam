import { describe, it, expect } from "vitest";
import { prisma } from "../src/db";
import { GmailConnector, EmailClient } from "../src/connectors/gmailConnector";
import { warnIfCalendarEnding } from "../src/services/calendarExpiryService";

function setup() {
  const emails: any[] = [];
  const pushes: any[] = [];
  const client: EmailClient = { send: async (e) => { emails.push(e); return { id: "1" }; } };
  const gmail = new GmailConnector("vp@school.edu", client);
  const notifier = { send: async (p: any) => { pushes.push(p); return true; } } as any;
  return { emails, pushes, gmail, notifier };
}

describe("school calendar ending warning", () => {
  it("stays quiet while the calendar runs well past 30 days", async () => {
    await prisma.calendarEvent.create({ data: { eventName: "Term end", eventDate: new Date("2027-04-30T00:00:00Z"), type: "EVENT" } });
    const t = setup();
    expect(await warnIfCalendarEnding(t.gmail, t.notifier, new Date("2027-02-01T06:00:00Z"))).toBe("not_due");
    expect(t.emails).toHaveLength(0);
  });

  it("emails her own address and notifies the phone within 30 days, then waits a week", async () => {
    await prisma.calendarEvent.create({ data: { eventName: "Last working day", eventDate: new Date("2027-04-30T00:00:00Z"), type: "EVENT" } });
    const t = setup();
    expect(await warnIfCalendarEnding(t.gmail, t.notifier, new Date("2027-04-10T06:00:00Z"))).toBe("sent");
    expect(t.emails[0].to).toBe("vp@school.edu");
    expect(t.emails[0].body).toMatch(/Last working day/);
    expect(t.pushes).toHaveLength(1);
    expect(await warnIfCalendarEnding(t.gmail, t.notifier, new Date("2027-04-12T06:00:00Z"))).toBe("already_warned");
    expect(await warnIfCalendarEnding(t.gmail, t.notifier, new Date("2027-04-18T06:00:00Z"))).toBe("sent");
  });

  it("still notifies the phone when Gmail is not connected", async () => {
    await prisma.calendarEvent.create({ data: { eventName: "End", eventDate: new Date("2027-04-30T00:00:00Z"), type: "EVENT" } });
    const t = setup();
    expect(await warnIfCalendarEnding(new GmailConnector("x"), t.notifier, new Date("2027-04-20T06:00:00Z"))).toBe("sent");
    expect(t.pushes).toHaveLength(1);
  });
});
