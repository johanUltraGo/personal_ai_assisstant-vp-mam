import { describe, it, expect } from "vitest";
import { prisma } from "../src/db";
import { sendMissedMorningList } from "../src/scheduler/morningListScheduler";

// 19 Nov 2026 in India (UTC+5:30).
const at = (hhmm: string) => new Date(`2026-11-19T${hhmm}:00+05:30`);

describe("morning list catch-up after a restart", () => {
  it("does nothing before 9 AM or after 6 PM", async () => {
    expect(await sendMissedMorningList(at("08:40"))).toBe(false);
    expect(await sendMissedMorningList(at("18:30"))).toBe(false);
    expect(await prisma.activityLog.count({ where: { kind: "morning_list.built" } })).toBe(0);
  });

  it("sends today's list once when the server starts after 9 AM and it was missed", async () => {
    expect(await sendMissedMorningList(at("10:15"))).toBe(true);
    expect(await prisma.activityLog.count({ where: { kind: "morning_list.built" } })).toBe(1);
    expect(await sendMissedMorningList(at("11:00"))).toBe(false);
  });
});
