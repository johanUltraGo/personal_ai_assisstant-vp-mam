import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { backupDatabase } from "../src/services/backupService";

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

  it("writes a consistent SQLite snapshot named by date and replaces a same-day copy", async () => {
    const now = new Date("2026-11-10T20:30:00Z"); // 11 Nov in India
    const first = await backupDatabase(now);
    expect(path.basename(first!.file)).toBe("vp-2026-11-11.db");
    const bytes = await fs.readFile(first!.file);
    expect(bytes.subarray(0, 15).toString()).toBe("SQLite format 3");
    expect(bytes.includes(Buffer.from("CREATE TABLE \"Task\""))).toBe(true);
    const again = await backupDatabase(now);
    expect(again!.file).toBe(first!.file);
  });

  it("removes backups older than the keep period", async () => {
    await fs.writeFile(path.join(dir, "vp-2026-10-20.db"), "old");
    await fs.writeFile(path.join(dir, "vp-2026-11-05.db"), "recent");
    await fs.writeFile(path.join(dir, "notes.txt"), "not ours");
    const result = await backupDatabase(new Date("2026-11-10T06:00:00Z"));
    expect(result!.removed).toEqual(["vp-2026-10-20.db"]);
    const left = (await fs.readdir(dir)).sort();
    expect(left).toEqual(["notes.txt", "vp-2026-11-05.db", "vp-2026-11-10.db"]);
  });

  it("does nothing for a non-SQLite database", async () => {
    const saved = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://example";
    expect(await backupDatabase()).toBeNull();
    process.env.DATABASE_URL = saved;
  });
});
