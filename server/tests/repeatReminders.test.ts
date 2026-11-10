import { describe, it, expect } from "vitest";
import { prisma } from "../src/db";
import * as reminderService from "../src/services/reminderService";

const ok = { send: async () => true };
const failing = { send: async () => false };
const DAY = 24 * 3600_000;

describe("repeating reminders", () => {
  it("keeps the daily repeat going after a delivery failure", async () => {
    const original = new Date(Date.now() - 60_000);
    const r = await reminderService.createReminder({ label: "Assembly", fireAt: original, repeatRule: "DAILY" });
    for (let i = 0; i < 3; i++) await reminderService.fireReminder(r.id, failing);
    expect((await prisma.reminder.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("FAILED");
    const next = await prisma.reminder.findFirstOrThrow({ where: { status: "PENDING", label: "Assembly" } });
    expect(next.fireAt.getTime()).toBe(original.getTime() + DAY);
  });

  it("does not let a snooze shift tomorrow's time", async () => {
    const original = new Date(Date.now() - 60_000);
    const r = await reminderService.createReminder({ label: "Water plants", fireAt: original, repeatRule: "DAILY" });
    await reminderService.snooze(r.id, 10);
    await prisma.reminder.update({ where: { id: r.id }, data: { fireAt: new Date(Date.now() - 1000) } }); // snooze elapsed
    await reminderService.fireReminder(r.id, ok);
    const next = await prisma.reminder.findFirstOrThrow({ where: { status: "PENDING", label: "Water plants" } });
    expect(next.fireAt.getTime()).toBe(original.getTime() + DAY);
  });
});
