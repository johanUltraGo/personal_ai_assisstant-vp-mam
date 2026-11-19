import { promises as fs } from "fs";
import path from "path";
import { DateTime } from "luxon";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { schoolTimezone } from "./morningListService";
import { logActivity } from "./activityService";
import { backupCloudStore } from "./fileStorage";

const FILE_PATTERN = /^vp-(\d{4}-\d{2}-\d{2})\.(json|db)$/;

/**
 * Every table, parents before children, so a restore can insert them in this
 * order and delete them in reverse.
 */
export const BACKUP_TABLES = [
  "task",
  "attachment",
  "taskHistory",
  "reminder",
  "reminderLog",
  "contact",
  "messageSent",
  "pendingMessage",
  "calendarEvent",
  "activityLog",
  "googleAccount",
  "conversation",
  "conversationMessage",
  "dayPlanConfirmation",
  "dayPlanProposal",
  "pushSubscription",
  "session",
] as const;

function backupDir() {
  return path.resolve(process.env.BACKUP_DIR || path.join(process.cwd(), "backups"));
}

function keepDays() {
  const days = Number(process.env.BACKUP_KEEP_DAYS ?? 14);
  return Number.isFinite(days) && days >= 1 ? Math.floor(days) : 14;
}

/**
 * Daily copy of her data (tasks, history, reminders, messages, chats) as one
 * JSON file, read inside a single repeatable-read transaction so every table
 * comes from the same moment. Supabase's free plan keeps no backups, so this
 * file is the backup: put BACKUP_DIR on another disk or a synced folder.
 * One file per school day; copies older than BACKUP_KEEP_DAYS are deleted.
 * Restore with: npm run restore -- backups/vp-YYYY-MM-DD.json
 */
export async function backupDatabase(now: Date = new Date()) {
  const dir = backupDir();
  await fs.mkdir(dir, { recursive: true });

  const today = DateTime.fromJSDate(now, { zone: schoolTimezone() });
  const file = path.join(dir, `vp-${today.toISODate()}.json`);
  const temp = `${file}.tmp`;
  for (const name of await fs.readdir(dir)) {
    if (/^vp-.*\.tmp$/.test(name)) await fs.rm(path.join(dir, name), { force: true });
  }

  const tables = await prisma.$transaction(
    async (tx) => {
      const out: Record<string, unknown[]> = {};
      for (const table of BACKUP_TABLES) out[table] = await (tx as any)[table].findMany();
      return out;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 120_000, maxWait: 30_000 }
  );
  const rows = Object.values(tables).reduce((n, list) => n + list.length, 0);
  const content = JSON.stringify({ format: "vp-backup", version: 1, createdAt: now.toISOString(), tables });
  await fs.writeFile(temp, content);
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

  // In the cloud the server's disk is temporary, so the copy that counts is
  // the one in the private Supabase "backups" bucket (same name, same keep period).
  const cloud = backupCloudStore();
  let inCloud = false;
  if (cloud) {
    await cloud.put(path.basename(file), Buffer.from(content), "application/json", { overwrite: true });
    inCloud = true;
    for (const name of await cloud.list()) {
      const match = name.match(FILE_PATTERN);
      if (match && match[1] < cutoff) await cloud.remove(name);
    }
  }
  await logActivity(
    "backup.created",
    `Saved a backup copy of your data (${path.basename(file)}, ${rows} records${inCloud ? ", also in Supabase" : ""}).`
  );
  return { file, rows, removed, inCloud };
}

/**
 * Replaces everything in the database with a backup file's contents. Used by
 * scripts/restore-backup.ts only; never called by the running server.
 */
export async function restoreBackup(file: string) {
  const parsed = JSON.parse(await fs.readFile(file, "utf8"));
  if (parsed?.format !== "vp-backup" || typeof parsed.tables !== "object") throw new Error(`${file} is not a VP Assistant backup.`);
  const counts: Record<string, number> = {};
  await prisma.$transaction(
    async (tx) => {
      for (const table of [...BACKUP_TABLES].reverse()) await (tx as any)[table].deleteMany();
      for (const table of BACKUP_TABLES) {
        const rows = parsed.tables[table] ?? [];
        if (rows.length) await (tx as any)[table].createMany({ data: rows });
        counts[table] = rows.length;
      }
    },
    { timeout: 300_000, maxWait: 30_000 }
  );
  return counts;
}
