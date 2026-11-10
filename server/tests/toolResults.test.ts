import { describe, it, expect } from "vitest";
import { prisma } from "../src/db";
import { runTool } from "../src/assistant/tools";
import "../src/assistant/registerFeatureTools";

const ctx = () => ({ conversationId: "c", inputMode: "TYPED" as const, cards: [] });

describe("tool results sent back to Claude", () => {
  it("sends calendar events as JSON text, not as content blocks", async () => {
    await prisma.calendarEvent.create({ data: { eventName: "Diwali", eventDate: new Date("2026-11-12T00:00:00+05:30"), type: "HOLIDAY" } });
    const result = await runTool("get_school_calendar", { from: "2026-11-11", to: "2026-11-13" }, ctx());
    expect(typeof result.content).toBe("string");
    expect(JSON.parse(result.content as string)[0].type).toBe("HOLIDAY");
  });

  it("sends an empty list as text", async () => {
    const result = await runTool("list_reminders", {}, ctx());
    expect(result.content).toBe("[]");
  });
});
