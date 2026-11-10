import { describe, it, expect } from "vitest";
import request from "supertest";
import { prisma } from "../src/db";
import { createApp } from "../src/app";
import { logActivity, recentActivity } from "../src/services/activityService";
import * as reminderService from "../src/services/reminderService";
import * as taskService from "../src/services/taskService";
import { buildMorningList } from "../src/services/morningListService";

const failing = { send: async () => false };

describe("activity log", () => {
  it("records and lists entries newest first", async () => {
    await logActivity("test.one", "First");
    await logActivity("test.two", "Second", { type: "Task", id: "t1" });
    const list = await recentActivity(10);
    expect(list[0].kind).toBe("test.two");
    expect(list[0].refId).toBe("t1");
    const res = await request(createApp()).get("/api/activity?limit=1");
    expect(res.body).toHaveLength(1);
  });

  it("logs a delivered reminder", async () => {
    const r = await reminderService.createReminder({ label: "Call Mrs Iyer", fireAt: new Date(Date.now() - 1000) });
    await reminderService.fireReminder(r.id);
    const kinds = (await prisma.activityLog.findMany()).map((a) => a.kind);
    expect(kinds).toContain("reminder.sent");
  });

  it("logs a reminder that failed three times", async () => {
    const r = await reminderService.createReminder({ label: "x", fireAt: new Date(Date.now() - 1000) });
    for (let i = 0; i < 3; i++) await reminderService.fireReminder(r.id, failing);
    const failed = await prisma.activityLog.findMany({ where: { kind: "reminder.failed" } });
    expect(failed).toHaveLength(1);
  });

  it("logs the morning list with its task count", async () => {
    const now = new Date();
    await taskService.createTask({
      title: "Assembly", timeWindowStart: new Date(now.getTime() + 60_000), timeWindowEnd: new Date(now.getTime() + 120_000),
    });
    await buildMorningList(now);
    const entry = await prisma.activityLog.findFirst({ where: { kind: "morning_list.built" } });
    expect(entry?.summary).toMatch(/\d+ task/);
  });
});
