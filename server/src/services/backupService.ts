import { promises as fs } from "fs";
import path from "path";
import { DateTime } from "luxon";
import { prisma } from "../db";
import { schoolTimezone } from "./morningListService";
import { logActivity } from "./activityService";

const FILE_PATTERN = /^vp-(\d{4}-\d{2}-\d{2})\.db$/;

function backupDir() {
  return path.resolve(process.env.BACKUP_DIR || path.join(process.cwd(), "backups"));
}

function keepDays() {
  const days = Number(process.env.BACKUP_KEEP_DAYS ?? 14);
  return Number.isFinite(days) && days >= 1 ? Math.floor(days) : 14;
}

/**
 * Daily copy of her data (tasks, history, reminders, messages). SQLite's
 * VACUUM INTO writes a consistent snapshot even while the server is using the
 * database. One file per school day; copies older than BACKUP_KEEP_DAYS are
 * deleted. Returns null when the database is not a local SQLite file.
 */
export async function backupDatabase(now: Date = new Date()) {
  if (!(process.env.DATABASE_URL ?? "").startsWith("file:")) return null;
  const dir = backupDir();
  await fs.mkdir(dir, { recursive: true });

  const today = DateTime.fromJSDate(now, { zone: schoolTimezone() });
  const file = path.join(dir, `vp-${today.toISODate()}.db`);
  const temp = `${file}.tmp`;
  for (const name of await fs.readdir(dir)) {
    if (/^vp-.*\.db\.tmp$/.test(name)) await fs.rm(path.join(dir, name), { force: true });
  }
  await prisma.$executeRawUnsafe(`VACUUM INTO '${temp.replace(/'/g, "''")}'`);
  await fs.rm(file, { force: true });
  await fs.rename(temp, file);

  const cutoff = today.startOf("day").minus({ days: keepDays() }).toISODate()!;
  const removed: string[] = [];
  for (const name of await fs.readdir(dir)) {
    const match = name.match(FILE_PATTERN);
    if (match && match[1] < cutoff) {
      await fs.rm(path.join(dir, name), { force: true });
      removed.push(name);
    }
  }
  await logActivity("backup.created", `Saved a backup copy of your data (${path.basename(file)}).`);
  return { file, removed };
}
