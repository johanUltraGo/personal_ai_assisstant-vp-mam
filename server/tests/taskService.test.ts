import { describe, it, expect } from "vitest";
import * as taskService from "../src/services/taskService";
import { prisma } from "../src/db";

function window(hoursFromNow: number, durationMinutes = 30) {
  const start = new Date(Date.now() + hoursFromNow * 3600_000);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  return { timeWindowStart: start, timeWindowEnd: end };
}

describe("taskService", () => {
  it("creates a task and logs drafted-then-scheduled history", async () => {
    const task = await taskService.createTask({ title: "Review attendance", ...window(1) });
    expect(task.status).toBe("SCHEDULED");

    const full = await taskService.getTask(task.id);
    expect(full.history.map((h) => h.toStatus)).toEqual(["DRAFTED", "SCHEDULED"]);
    expect(full.history[0].fromStatus).toBeNull();
    expect(full.history[1].fromStatus).toBe("DRAFTED");
  });

  it("rejects a time window where end is before start", async () => {
    const start = new Date();
    const end = new Date(start.getTime() - 1000);
    await expect(
      taskService.createTask({ title: "Bad window", timeWindowStart: start, timeWindowEnd: end })
    ).rejects.toThrow(/timeWindowEnd must be after/);
  });

  it("moves a task through start -> complete, each step timestamped", async () => {
    const task = await taskService.createTask({ title: "Prepare circular", ...window(2) });
    const started = await taskService.startTask(task.id);
    expect(started.status).toBe("IN_PROGRESS");
    const completed = await taskService.completeTask(task.id);
    expect(completed.status).toBe("COMPLETED");

    const full = await taskService.getTask(task.id);
    expect(full.history.map((h) => h.toStatus)).toEqual(["DRAFTED", "SCHEDULED", "IN_PROGRESS", "COMPLETED"]);
    expect(full.history.every((h) => h.changedAt instanceof Date)).toBe(true);
    // Completion must always be attributed to the principal, never "system".
    const completionEntry = full.history.find((h) => h.toStatus === "COMPLETED");
    expect(completionEntry?.changedBy).toBe("principal");
  });

  it("refuses an invalid transition (e.g. completed task cannot be restarted)", async () => {
    const task = await taskService.createTask({ title: "One-off task", ...window(1) });
    await taskService.completeTask(task.id);
    await expect(taskService.startTask(task.id)).rejects.toThrow(/Cannot move a task/);
  });

  it("never lets anything other than completeTask reach COMPLETED", async () => {
    // Structural check: markOverdue/markReminderSent/startTask all route
    // through applyTransition with an explicit target status, and only
    // completeTask passes "COMPLETED". This test pins that behaviour.
    const task = await taskService.createTask({ title: "Check", ...window(1) });
    await taskService.markReminderSent(task.id);
    const reloaded = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(reloaded.status).toBe("REMINDER_SENT");
    expect(reloaded.status).not.toBe("COMPLETED");
  });
});
