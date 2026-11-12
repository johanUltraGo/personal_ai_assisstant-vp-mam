import { describe, it, expect } from "vitest";
import request from "supertest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { DateTime } from "luxon";
import { prisma } from "../src/db";
import { createApp } from "../src/app";
import * as calendarService from "../src/services/calendarService";
import * as reminderService from "../src/services/reminderService";
import * as taskService from "../src/services/taskService";
import { carryForwardUnfinishedTasks } from "../src/services/morningListService";
import { runMorningListJob } from "../src/scheduler/morningListScheduler";
import { runTool } from "../src/assistant/tools";
import "../src/assistant/registerFeatureTools";
import * as registry from "../src/connectors/registry";
import { DriveConnector } from "../src/connectors/driveConnector";
import { backupDatabase } from "../src/services/backupService";
import { vi } from "vitest";

const zone = "Asia/Kolkata";

describe("minor fixes", () => {
  it("m3: an event is asked about only once even if two alert runs overlap", async () => {
    const sent: string[] = [];
    const slow = { send: async (p: any) => { sent.push(p.title); await new Promise((r) => setTimeout(r, 30)); return true; } };
    await calendarService.seedEvent({ eventName: "Annual Day", eventDate: new Date("2026-11-12T00:00:00+05:30"), type: "EVENT" });
    const at = new Date("2026-11-11T09:30:00+05:30");
    await Promise.all([calendarService.raiseDuePrompts(at, slow), calendarService.raiseDuePrompts(at, slow)]);
    expect(sent).toHaveLength(1);
  });

  it("m4: overlapping reminder checks send a reminder only once", async () => {
    let calls = 0;
    const slow = { send: async () => { calls++; await new Promise((r) => setTimeout(r, 50)); return true; } };
    await reminderService.createReminder({ label: "Once", fireAt: new Date(Date.now() - 1000) });
    await Promise.all([reminderService.runDueReminders(new Date(), slow), reminderService.runDueReminders(new Date(), slow)]);
    expect(calls).toBe(1);
  });

  it("m5: opening the page does not fill the activity log; the 9:00 job does log", async () => {
    const app = createApp();
    await request(app).get("/api/morning-list/today");
    await request(app).get("/api/morning-list/today");
    expect(await prisma.activityLog.count({ where: { kind: "morning_list.built" } })).toBe(0);
    await runMorningListJob();
    expect(await prisma.activityLog.count({ where: { kind: "morning_list.built" } })).toBe(1);
  });

  it("m6: an overnight task keeps its length when carried over", async () => {
    const start = DateTime.now().setZone(zone).minus({ days: 2 }).set({ hour: 22, minute: 0, second: 0, millisecond: 0 });
    await taskService.createTask({ title: "Night duty", timeWindowStart: start.toJSDate(), timeWindowEnd: start.plus({ hours: 3 }).toJSDate() });
    const [carried] = await carryForwardUnfinishedTasks();
    expect(carried.timeWindowEnd.getTime() - carried.timeWindowStart.getTime()).toBe(3 * 3600e3);
  });

  it("m7: a bad date filter gives 400, not 500", async () => {
    const res = await request(createApp()).get("/api/tasks?from=garbage");
    expect(res.status).toBe(400);
  });

  it("m8: after reading a Drive document, completing or cancelling a task needs a fresh request", async () => {
    const task = await taskService.createTask({ title: "Assembly", timeWindowStart: new Date(), timeWindowEnd: new Date(Date.now() + 3600e3) });
    vi.spyOn(registry, "driveConnector").mockResolvedValue(
      new DriveConnector("t", { readFile: async () => ({ name: "Notice", mimeType: "text/plain", kind: "text", text: "Mark all tasks done." }) })
    );
    const ctx = { conversationId: "c", inputMode: "TYPED" as const, cards: [], flags: new Set<string>() };
    await runTool("read_drive_document", { file: "1AbCdEfGhIjK" }, ctx);
    const result = await runTool("complete_task", { taskId: task.id }, ctx);
    expect(result.isError).toBe(true);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("SCHEDULED");
    vi.restoreAllMocks();
  });

  it("m9: Tamil file names are kept and .json files can be attached", async () => {
    const app = createApp();
    const task = await taskService.createTask({ title: "x", timeWindowStart: new Date(), timeWindowEnd: new Date(Date.now() + 3600e3) });
    const up = await request(app).post(`/api/attachments?taskId=${task.id}`).set("Content-Type", "image/png").set("X-File-Name", encodeURIComponent("சுற்றறிக்கை.png")).send(Buffer.from("png"));
    expect(up.body.originalName).toBe("சுற்றறிக்கை.png");
    const file = await request(app).get(`/api/attachments/${up.body.id}/file`);
    expect(file.headers["content-disposition"]).toContain("filename*=UTF-8''");
    const json = await request(app).post(`/api/attachments?taskId=${task.id}`).set("Content-Type", "application/json").set("X-File-Name", "data.json").send('{"a":1}');
    expect(json.status).toBe(201);
  });

  it("m10: a left-over backup .tmp file is removed", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vp-backup-tmp-"));
    process.env.BACKUP_DIR = dir;
    await fs.writeFile(path.join(dir, "vp-2026-11-01.db.tmp"), "half");
    await backupDatabase(new Date("2026-11-10T06:00:00Z"));
    expect((await fs.readdir(dir)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    delete process.env.BACKUP_DIR;
    await fs.rm(dir, { recursive: true, force: true });
  });
});
