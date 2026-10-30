import { describe, it, expect } from "vitest";
import * as calendarService from "../src/services/calendarService";
import { prisma } from "../src/db";

function daysFromNow(days: number) {
  return new Date(Date.now() + days * 24 * 3600_000);
}

describe("calendarService", () => {
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
