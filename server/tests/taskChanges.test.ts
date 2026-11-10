import { describe, it, expect } from "vitest";
import request from "supertest";
import { DateTime } from "luxon";
import * as taskService from "../src/services/taskService";
import { buildMorningList, confirmDay, carryForwardUnfinishedTasks } from "../src/services/morningListService";
import { createApp } from "../src/app";

const zone = "Asia/Kolkata";

describe("task changes and morning confirmation", () => {
  it("re-times a task and logs the move in history", async () => {
    const start = DateTime.now().setZone(zone).plus({ hours: 2 });
    const task = await taskService.createTask({ title: "Staff meeting", timeWindowStart: start.toJSDate(), timeWindowEnd: start.plus({ minutes: 30 }).toJSDate() });
    const newStart = start.plus({ hours: 1 }).toJSDate();
    const updated = await taskService.updateTask(task.id, { timeWindowStart: newStart, timeWindowEnd: new Date(newStart.getTime() + 30 * 60_000) });
    expect(updated.timeWindowStart.toISOString()).toBe(newStart.toISOString());
    const full = await taskService.getTask(task.id);
    expect(full.history.at(-1)?.note).toMatch(/^Moved/);
    await expect(taskService.updateTask(task.id, { timeWindowStart: newStart, timeWindowEnd: newStart })).rejects.toThrow(/after/);
  });

  it("cancelled tasks leave today's list and never carry over", async () => {
    const yesterday = DateTime.now().setZone(zone).minus({ days: 1 }).set({ hour: 10 });
    const old = await taskService.createTask({ title: "Old", timeWindowStart: yesterday.toJSDate(), timeWindowEnd: yesterday.plus({ hours: 1 }).toJSDate() });
    await taskService.cancelTask(old.id, "no longer needed");
    expect(await carryForwardUnfinishedTasks()).toHaveLength(0);

    const later = DateTime.now().setZone(zone).plus({ minutes: 5 });
    const today = await taskService.createTask({ title: "Today", timeWindowStart: later.toJSDate(), timeWindowEnd: later.plus({ minutes: 30 }).toJSDate() });
    await taskService.cancelTask(today.id);
    const list = await buildMorningList();
    expect(list.tasks.find((t) => t.id === today.id)).toBeUndefined();
    const full = await taskService.getTask(today.id);
    expect(full.status).toBe("CANCELLED");
    expect(full.history.at(-1)?.changedBy).toBe("principal");
  });

  it("records the morning confirmation and shows it on the list", async () => {
    const list = await buildMorningList();
    expect(list.confirmedAt).toBeNull();
    await confirmDay(list.date!, "BUTTON");
    expect((await buildMorningList()).confirmedAt).not.toBeNull();
  });

  it("exposes cancel, re-time and confirm over HTTP", async () => {
    const app = createApp();
    const start = DateTime.now().setZone(zone).plus({ hours: 3 });
    const created = await request(app).post("/api/tasks").send({ title: "Call", timeWindowStart: start.toISO(), timeWindowEnd: start.plus({ minutes: 15 }).toISO() });
    const moved = await request(app).patch(`/api/tasks/${created.body.id}`).send({ timeWindowStart: start.plus({ hours: 1 }).toISO(), timeWindowEnd: start.plus({ hours: 1, minutes: 15 }).toISO() });
    expect(moved.status).toBe(200);
    expect((await request(app).post(`/api/tasks/${created.body.id}/cancel`).send({})).body.status).toBe("CANCELLED");
    const confirmed = await request(app).post("/api/morning-list/confirm");
    expect(confirmed.status).toBe(200);
    expect((await request(app).get("/api/morning-list/today")).body.confirmedAt).not.toBeNull();
  });
});
