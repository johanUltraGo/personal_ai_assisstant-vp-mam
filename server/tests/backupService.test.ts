import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { prisma } from "../src/db";
import { backupDatabase, restoreBackup } from "../src/services/backupService";

let dir: string;

describe("daily database backup", () => {
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "vp-backup-"));
    process.env.BACKUP_DIR = dir;
    process.env.BACKUP_KEEP_DAYS = "14";
  });
  afterEach(async () => {
    delete process.env.BACKUP_DIR;
    delete process.env.BACKUP_KEEP_DAYS;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("writes every table to a file named by date and replaces a same-day copy", async () => {
    await prisma.contact.create({ data: { displayName: "Parents group", kind: "GROUP" } });
    const now = new Date("2026-11-10T20:30:00Z"); // 11 Nov in India
    const first = await backupDatabase(now);
    expect(path.basename(first.file)).toBe("vp-2026-11-11.json");
    const saved = JSON.parse(await fs.readFile(first.file, "utf8"));
    expect(saved.format).toBe("vp-backup");
    expect(saved.tables.contact.map((c: any) => c.displayName)).toEqual(["Parents group"]);
    expect(Object.keys(saved.tables)).toContain("task");
    const again = await backupDatabase(now);
    expect(again.file).toBe(first.file);
  });

  it("removes backups older than the keep period, old .db copies included", async () => {
    await fs.writeFile(path.join(dir, "vp-2026-10-20.db"), "old");
    await fs.writeFile(path.join(dir, "vp-2026-10-21.json"), "{}");
    await fs.writeFile(path.join(dir, "vp-2026-11-05.json"), "{}");
    await fs.writeFile(path.join(dir, "notes.txt"), "not ours");
    const result = await backupDatabase(new Date("2026-11-10T06:00:00Z"));
    expect(result.removed.sort()).toEqual(["vp-2026-10-20.db", "vp-2026-10-21.json"]);
    const left = (await fs.readdir(dir)).sort();
    expect(left).toEqual(["notes.txt", "vp-2026-11-05.json", "vp-2026-11-10.json"]);
  });

  it("restores a backup over whatever is there now", async () => {
    const task = await prisma.task.create({
      data: { title: "Staff meeting", timeWindowStart: new Date("2026-11-10T05:30:00Z"), timeWindowEnd: new Date("2026-11-10T06:00:00Z") },
    });
    await prisma.taskHistory.create({ data: { taskId: task.id, toStatus: "DRAFTED" } });
    const { file } = await backupDatabase(new Date("2026-11-10T06:00:00Z"));
    await prisma.task.deleteMany();
    await prisma.contact.create({ data: { displayName: "Added after the backup" } });

    const counts = await restoreBackup(file);
    expect(counts.task).toBe(1);
    const restored = await prisma.task.findUniqueOrThrow({ where: { id: task.id }, include: { history: true } });
    expect(restored.title).toBe("Staff meeting");
    expect(restored.history).toHaveLength(1);
    expect(restored.timeWindowStart.toISOString()).toBe("2026-11-10T05:30:00.000Z");
    expect(await prisma.contact.count()).toBe(0);
  });
});
