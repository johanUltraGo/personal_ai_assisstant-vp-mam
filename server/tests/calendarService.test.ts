import { describe, it, expect } from "vitest";
import * as calendarService from "../src/services/calendarService";
import { prisma } from "../src/db";

function daysFromNow(days: number) {
  return new Date(Date.now() + days * 24 * 3600_000);
}

describe("calendarService", () => {
  it("parses all-day iCalendar exports in the school's timezone", () => {
    const events = calendarService.parseCalendarFile(
      "BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Diwali Holiday\nDTSTART;VALUE=DATE:20261112\nEND:VEVENT\nEND:VCALENDAR"
    );
    expect(events).toHaveLength(1);
    expect(events[0].eventName).toBe("Diwali Holiday");
    expect(events[0].type).toBe("HOLIDAY");
  });

  it("parses a portable JSON calendar export", () => {
    const events = calendarService.parseCalendarFile(
      JSON.stringify([{ eventName: "Sports Day", eventDate: "2026-11-20", type: "EVENT" }])
    );
    expect(events[0].eventName).toBe("Sports Day");
  });

  it("flags an event exactly two days out as needing a prompt", async () => {
    const diwali = await calendarService.seedEvent({ eventName: "Diwali", eventDate: daysFromNow(2), type: "HOLIDAY" });
    await calendarService.seedEvent({ eventName: "Sports Day", eventDate: daysFromNow(5), type: "EVENT" });

    const due = await calendarService.findEventsNeedingPrompt();
    expect(due.map((e) => e.id)).toEqual([diwali.id]);
  });

  it("does not re-flag an event that has already been prompted about", async () => {
    const event = await calendarService.seedEvent({ eventName: "Annual Day", eventDate: daysFromNow(2), type: "EVENT" });
    await calendarService.markPrompted(event.id);

    const due = await calendarService.findEventsNeedingPrompt();
    expect(due).toHaveLength(0);
  });

  it("marks notifiedAt only when she approves sending", async () => {
    const event = await calendarService.seedEvent({ eventName: "Republic Day", eventDate: daysFromNow(2), type: "HOLIDAY" });

    const declined = await calendarService.recordDecision(event.id, false);
    expect(declined.promptedAt).not.toBeNull();
    expect(declined.notifiedAt).toBeNull();

    const reSeeded = await calendarService.seedEvent({ eventName: "Republic Day 2", eventDate: daysFromNow(2), type: "HOLIDAY" });
    const approved = await calendarService.recordDecision(reSeeded.id, true);
    expect(approved.notifiedAt).not.toBeNull();
  });
});

describe("calendar import and alerts", () => {
  const at = (iso: string) => new Date(iso);

  it("reads a CSV export from a Google Sheet with Indian date order", () => {
    const events = calendarService.parseCalendarFile("Date,Event,Type\n12/11/2026,Diwali,Holiday\n2026-11-20,Sports Day,\n");
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ eventName: "Diwali", type: "HOLIDAY" });
    expect(events[0].eventDate.toISOString()).toBe("2026-11-11T18:30:00.000Z");
    expect(events[1].type).toBe("EVENT");
  });

  it("imports without creating duplicates on re-import", async () => {
    const csv = "Date,Event,Type\n12/11/2026,Diwali,Holiday";
    expect((await calendarService.importCalendar(csv)).created).toBe(1);
    expect((await calendarService.importCalendar(csv)).created).toBe(0);
    expect(await prisma.calendarEvent.count()).toBe(1);
  });

  it("asks once about events from tomorrow up to two days ahead, within 9 AM–6 PM", async () => {
    const sent: any[] = [];
    const notifier = { send: async (p: any) => { sent.push(p); return true; } };
    await calendarService.seedEvent({ eventName: "Diwali", eventDate: at("2026-11-12T00:00:00+05:30"), type: "HOLIDAY" });
    await calendarService.seedEvent({ eventName: "Later", eventDate: at("2026-11-20T00:00:00+05:30"), type: "EVENT" });

    expect(await calendarService.raiseDuePrompts(at("2026-11-10T07:00:00+05:30"), notifier)).toHaveLength(0);
    const raised = await calendarService.raiseDuePrompts(at("2026-11-11T10:00:00+05:30"), notifier);
    expect(raised.map((e) => e.eventName)).toEqual(["Diwali"]);
    expect(sent[0].body).toContain("parents");
    expect(await calendarService.raiseDuePrompts(at("2026-11-11T11:00:00+05:30"), notifier)).toHaveLength(0);
    expect((await calendarService.pendingPrompts(at("2026-11-11T11:00:00+05:30"))).map((e) => e.eventName)).toEqual(["Diwali"]);
  });

  it("records no, and drafts a notice on yes", async () => {
    const event = await calendarService.seedEvent({ eventName: "Annual Day", eventDate: at("2026-11-20T00:00:00+05:30"), type: "EVENT" });
    const draft = calendarService.draftEventNotice(event);
    expect(draft.body).toContain("Annual Day");
    expect(draft.body).toContain("20 November 2026");
    const declined = await calendarService.recordDecision(event.id, false);
    expect(declined.decision).toBe("DECLINED");
  });
});

describe("calendar API", () => {
  it("imports a CSV file and lists upcoming events", async () => {
    const { createApp } = await import("../src/app");
    const request = (await import("supertest")).default;
    const app = createApp();
    const res = await request(app).post("/api/calendar/import").set("Content-Type", "text/csv").send("Date,Event,Type\n01/01/2099,Founders Day,Event");
    expect(res.body).toEqual({ imported: 1, created: 1 });
    const events = await request(app).get("/api/calendar/events").query({ from: "2098-12-31", to: "2099-01-02" });
    expect(events.body[0].eventName).toBe("Founders Day");
    const yes = await request(app).post(`/api/calendar/events/${events.body[0].id}/respond`).send({ approved: true });
    expect(yes.body.draft.body).toContain("Founders Day");
  });
});
