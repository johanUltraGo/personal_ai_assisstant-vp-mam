import { describe, it, expect } from "vitest";
import * as reminderService from "../src/services/reminderService";
import { prisma } from "../src/db";
import type { Notifier } from "../src/notifiers/notifier";

class AlwaysSucceeds implements Notifier {
  async send() { return true; }
}
class AlwaysFails implements Notifier {
  async send() { return false; }
}

describe("reminderService", () => {
  it("only fires reminders that are actually due", async () => {
    const due = await reminderService.createReminder({ label: "Due now", fireAt: new Date(Date.now() - 1000) });
    await reminderService.createReminder({ label: "Not due yet", fireAt: new Date(Date.now() + 3600_000) });

    const fired = await reminderService.runDueReminders(new Date(), new AlwaysSucceeds());
    expect(fired).toHaveLength(1);
    expect(fired[0].id).toBe(due.id);
  });

  it("logs created, sent and delivered on a successful fire, and marks it fired exactly once", async () => {
    const reminder = await reminderService.createReminder({ label: "Call Mrs. Iyer", fireAt: new Date(Date.now() - 1000) });
    const result = await reminderService.fireReminder(reminder.id, new AlwaysSucceeds());
    expect(result.status).toBe("DELIVERED");

    const full = await prisma.reminder.findUniqueOrThrow({ where: { id: reminder.id }, include: { log: true } });
    expect(full.log.map((l) => l.eventType)).toEqual(["created", "sent", "delivered"]);

    // Firing again (e.g. a duplicate due-check tick) must be a no-op —
    // "each reminder is sent once" (spec §10).
    const again = await reminderService.fireReminder(reminder.id, new AlwaysSucceeds());
    expect(again.status).toBe("DELIVERED");
    const stillOneSend = await prisma.reminderLog.count({ where: { reminderId: reminder.id, eventType: "sent" } });
    expect(stillOneSend).toBe(1);
  });

  it("retries a failed send up to 3 times, then marks it FAILED for the app to surface", async () => {
    const reminder = await reminderService.createReminder({ label: "Flaky", fireAt: new Date(Date.now() - 1000) });
    const failer = new AlwaysFails();

    await reminderService.fireReminder(reminder.id, failer);
    let r = await prisma.reminder.findUniqueOrThrow({ where: { id: reminder.id } });
    expect(r.status).toBe("PENDING");
    expect(r.retryCount).toBe(1);

    await reminderService.fireReminder(reminder.id, failer);
    await reminderService.fireReminder(reminder.id, failer);
    r = await prisma.reminder.findUniqueOrThrow({ where: { id: reminder.id } });
    expect(r.retryCount).toBe(3);
    expect(r.status).toBe("FAILED");

    const failLogs = await prisma.reminderLog.count({ where: { reminderId: reminder.id, eventType: "failed" } });
    expect(failLogs).toBe(3);
  });

  it("creates the next occurrence when a repeating reminder fires successfully", async () => {
    const reminder = await reminderService.createReminder({
      label: "Weekly staff meeting prep",
      fireAt: new Date(Date.now() - 1000),
      repeatRule: "WEEKLY",
    });
    await reminderService.fireReminder(reminder.id, new AlwaysSucceeds());

    const all = await prisma.reminder.findMany({ where: { label: "Weekly staff meeting prep" } });
    expect(all).toHaveLength(2);
    const next = all.find((r) => r.id !== reminder.id)!;
    expect(next.status).toBe("PENDING");
    expect(next.fireAt.getTime() - reminder.fireAt.getTime()).toBeCloseTo(7 * 24 * 3600_000, -3);
  });

  it("logs snooze, delay, and reschedule as distinct, timestamped actions", async () => {
    const reminder = await reminderService.createReminder({ label: "Sign circular", fireAt: new Date(Date.now() + 3600_000) });

    await reminderService.snooze(reminder.id, 10);
    await reminderService.delay(reminder.id, 30);
    await reminderService.reschedule(reminder.id, new Date(Date.now() + 10 * 3600_000));

    const full = await prisma.reminder.findUniqueOrThrow({ where: { id: reminder.id }, include: { log: true } });
    const eventTypes = full.log.map((l) => l.eventType);
    expect(eventTypes).toEqual(["created", "snoozed", "delayed", "rescheduled"]);
    expect(full.log.every((l) => l.eventAt instanceof Date)).toBe(true);
  });

  it("marks the linked task's state when its reminder fires", async () => {
    const task = await (await import("../src/services/taskService")).createTask({
      title: "Submit exam duty roster",
      timeWindowStart: new Date(Date.now() + 3600_000),
      timeWindowEnd: new Date(Date.now() + 2 * 3600_000),
    });
    const reminder = await reminderService.createReminder({
      label: "Submit exam duty roster",
      fireAt: new Date(Date.now() - 1000),
      taskId: task.id,
    });
    await reminderService.fireReminder(reminder.id, new AlwaysSucceeds());

    const reloadedTask = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(reloadedTask.status).toBe("REMINDER_SENT");
  });
});
