import { describe, it, expect } from "vitest";
import * as taskService from "../src/services/taskService";
import { buildMorningList, carryForwardUnfinishedTasks } from "../src/services/morningListService";
import { prisma } from "../src/db";

function yesterdayWindow() {
  const start = new Date(Date.now() - 26 * 3600_000);
  const end = new Date(start.getTime() + 30 * 60_000);
  return { timeWindowStart: start, timeWindowEnd: end };
}

function todayWindow(hoursFromNow = 1) {
  const start = new Date(Date.now() + hoursFromNow * 3600_000);
  const end = new Date(start.getTime() + 30 * 60_000);
  return { timeWindowStart: start, timeWindowEnd: end };
}

describe("morningListService", () => {
  it("carries an unfinished task from yesterday into today, marking it overdue first", async () => {
    const stale = await taskService.createTask({ title: "Submit report", ...yesterdayWindow() });

    const carried = await carryForwardUnfinishedTasks();
    expect(carried).toHaveLength(1);
    expect(carried[0].id).toBe(stale.id);
    expect(carried[0].status).toBe("SCHEDULED");
    expect(carried[0].carriedOverCount).toBe(1);

    const full = await taskService.getTask(stale.id);
    const statuses = full.history.map((h) => h.toStatus);
    expect(statuses).toEqual(["DRAFTED", "SCHEDULED", "OVERDUE", "SCHEDULED"]);
    expect(full.history.at(-1)?.note).toMatch(/Carried over from/);
  });

  it("does not carry forward a task that was already completed", async () => {
    const done = await taskService.createTask({ title: "Already done", ...yesterdayWindow() });
    await taskService.completeTask(done.id);

    const carried = await carryForwardUnfinishedTasks();
    expect(carried).toHaveLength(0);
    const reloaded = await prisma.task.findUniqueOrThrow({ where: { id: done.id } });
    expect(reloaded.status).toBe("COMPLETED");
  });

  it("builds today's morning list from today's tasks plus anything carried forward", async () => {
    await taskService.createTask({ title: "Stale task", ...yesterdayWindow() });
    await taskService.createTask({ title: "Today's task", ...todayWindow(2) });

    const list = await buildMorningList();
    const titles = list.tasks.map((t) => t.title).sort();
    expect(titles).toEqual(["Stale task", "Today's task"]);
  });

  it("excludes tasks scheduled for tomorrow", async () => {
    await taskService.createTask({ title: "Tomorrow's task", ...todayWindow(30) });
    const list = await buildMorningList();
    expect(list.tasks.map((t) => t.title)).not.toContain("Tomorrow's task");
  });
});
