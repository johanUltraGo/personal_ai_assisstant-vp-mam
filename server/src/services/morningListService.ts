import { DateTime } from "luxon";
import { prisma } from "../db";
import * as taskService from "./taskService";
import { logActivity } from "./activityService";

const DEFAULT_TIMEZONE = "Asia/Kolkata";

/** IANA timezone the school day is computed in. Spec doesn't state her
 * timezone explicitly (❓ in planning.md) — defaults to Indian school
 * hours via SCHOOL_TIMEZONE env var; confirm before relying on this
 * for a real deployment. */
export function schoolTimezone(): string {
  return process.env.SCHOOL_TIMEZONE || DEFAULT_TIMEZONE;
}

export function startOfDay(reference: Date = new Date()): DateTime {
  return DateTime.fromJSDate(reference, { zone: schoolTimezone() }).startOf("day");
}

/**
 * Carries forward every task whose time window ended before today and
 * which never reached COMPLETED (spec §10: "Unfinished tasks carry over
 * to the next day's plan"). Each carried task keeps its original
 * time-of-day but moves to today, and is marked OVERDUE first if it
 * wasn't already, so the audit trail is accurate about what happened
 * before the carry-forward.
 */
export async function carryForwardUnfinishedTasks(reference: Date = new Date()) {
  const today = startOfDay(reference);
  const stale = await prisma.task.findMany({
    where: {
      status: { notIn: ["COMPLETED", "CANCELLED"] },
      timeWindowEnd: { lt: today.toJSDate() },
    },
  });

  const carried = [];
  for (const task of stale) {
    const fromDate = DateTime.fromJSDate(task.timeWindowEnd, { zone: schoolTimezone() }).toISODate();
    if (task.status !== "OVERDUE") {
      await taskService.markOverdue(task.id);
    }
    const originalStart = DateTime.fromJSDate(task.timeWindowStart, { zone: schoolTimezone() });
    const originalEnd = DateTime.fromJSDate(task.timeWindowEnd, { zone: schoolTimezone() });
    const newStart = today.set({ hour: originalStart.hour, minute: originalStart.minute });
    const newEnd = today.set({ hour: originalEnd.hour, minute: originalEnd.minute });
    const updated = await taskService.carryForward(
      task.id,
      newStart.toJSDate(),
      newEnd.toJSDate(),
      fromDate ?? "a previous day"
    );
    carried.push(updated);
  }
  return carried;
}

/**
 * Builds the 9:00 AM full work list (spec §3): everything scheduled for
 * today, including whatever just got carried forward. This function only
 * compiles the list — delivery (push notification) is Phase 2's concern.
 */
export async function buildMorningList(reference: Date = new Date()) {
  const carried = await carryForwardUnfinishedTasks(reference);
  const today = startOfDay(reference);
  const tomorrow = today.plus({ days: 1 });
  const tasks = await prisma.task.findMany({
    where: {
      timeWindowStart: { gte: today.toJSDate(), lt: tomorrow.toJSDate() },
      status: { notIn: ["COMPLETED", "CANCELLED"] },
    },
    orderBy: { timeWindowStart: "asc" },
  });
  await logActivity(
    "morning_list.built",
    `Prepared the work list for ${today.toISODate()}: ${tasks.length} task(s)` +
      (carried.length ? `, ${carried.length} carried over from earlier days.` : ".")
  );
  const confirmation = await prisma.dayPlanConfirmation.findUnique({ where: { date: today.toISODate()! } });
  return {
    date: today.toISODate(),
    generatedAt: new Date().toISOString(),
    confirmedAt: confirmation?.confirmedAt ?? null,
    tasks,
  };
}

/** Her "looks good" for a day's list (spec §3), by button or by telling the assistant. */
export async function confirmDay(date: string, via: "BUTTON" | "ASSISTANT") {
  const confirmation = await prisma.dayPlanConfirmation.upsert({
    where: { date },
    create: { date, via },
    update: { confirmedAt: new Date(), via },
  });
  await logActivity("morning_list.confirmed", `You confirmed the work list for ${date}.`);
  return confirmation;
}

/** Tasks scheduled on a given school day (not cancelled), for the assistant and the screen. */
export async function tasksForDay(date: string) {
  const day = DateTime.fromISO(date, { zone: schoolTimezone() }).startOf("day");
  return prisma.task.findMany({
    where: { timeWindowStart: { gte: day.toJSDate(), lt: day.plus({ days: 1 }).toJSDate() }, status: { not: "CANCELLED" } },
    orderBy: { timeWindowStart: "asc" },
  });
}
