import { prisma } from "../db";
import { Notifier, ConsoleNotifier } from "../notifiers/notifier";
import * as taskService from "./taskService";
import { logActivity } from "./activityService";

const MAX_RETRIES = 3;

export interface CreateReminderInput {
  label: string;
  fireAt: Date;
  taskId?: string;
  /** Minimal recurrence support — spec §10 only says "repeats happen only
   * if she sets them", with no format specified. Keeping this to the two
   * literal values actually needed avoids inventing an RRULE-style engine
   * the spec never asked for. */
  repeatRule?: "DAILY" | "WEEKLY";
}

export async function createReminder(input: CreateReminderInput) {
  const reminder = await prisma.reminder.create({
    data: {
      label: input.label,
      fireAt: input.fireAt,
      taskId: input.taskId,
      repeatRule: input.repeatRule,
      repeatAnchor: input.repeatRule ? input.fireAt : null,
      status: "PENDING",
    },
  });
  await prisma.reminderLog.create({
    data: { reminderId: reminder.id, eventType: "created", details: input.fireAt.toISOString() },
  });
  return reminder;
}

export async function dueReminders(reference: Date = new Date()) {
  return prisma.reminder.findMany({
    where: { status: "PENDING", fireAt: { lte: reference } },
    orderBy: { fireAt: "asc" },
  });
}

function nextOccurrence(fireAt: Date, rule: "DAILY" | "WEEKLY"): Date {
  const days = rule === "DAILY" ? 1 : 7;
  return new Date(fireAt.getTime() + days * 24 * 3600_000);
}

/**
 * Spec §10: repeats happen only if she set them. The next occurrence is
 * planned from the original time (repeatAnchor), once this one is used up —
 * delivered or finally failed — so snoozes and retries never shift it.
 */
async function scheduleNextOccurrence(reminder: { label: string; fireAt: Date; taskId: string | null; repeatRule: string | null; repeatAnchor: Date | null }) {
  if (reminder.repeatRule !== "DAILY" && reminder.repeatRule !== "WEEKLY") return;
  let next = nextOccurrence(reminder.repeatAnchor ?? reminder.fireAt, reminder.repeatRule);
  // If the server was off for days, skip occurrences already in the past.
  while (next.getTime() < Date.now() - 60_000) next = nextOccurrence(next, reminder.repeatRule);
  await createReminder({ label: reminder.label, fireAt: next, taskId: reminder.taskId ?? undefined, repeatRule: reminder.repeatRule });
}

/**
 * Attempts delivery of one due reminder. Spec §10 rules encoded here:
 * - fires once; a repeat only happens if she set one, as a brand-new
 *   reminder for the next occurrence (this one still only "fires once").
 * - failed sends retry up to 3 times, then the reminder is left in a
 *   FAILED state that the app surfaces to her.
 * - every attempt's sent/delivered/failed status is logged.
 */
export async function fireReminder(reminderId: string, notifier: Notifier = new ConsoleNotifier()) {
  const reminder = await prisma.reminder.findUniqueOrThrow({ where: { id: reminderId } });
  if (reminder.status !== "PENDING") return reminder;

  let delivered = false;
  try {
    delivered = await notifier.send({ title: "Reminder", body: reminder.label, data: { reminderId, url: "/#reminders-section" } });
  } catch {
    delivered = false;
  }

  if (delivered) {
    await prisma.reminder.update({
      where: { id: reminderId },
      data: { status: "SENT" },
    });
    await prisma.reminderLog.create({ data: { reminderId, eventType: "sent" } });
    // Web Push confirms delivery later from the phone (markDelivered); the
    // console stand-in counts as delivered at once.
    let updated = await prisma.reminder.findUniqueOrThrow({ where: { id: reminderId } });
    if (notifier.confirmsDelivery !== false) {
      await prisma.reminderLog.create({ data: { reminderId, eventType: "delivered" } });
      updated = await prisma.reminder.update({ where: { id: reminderId }, data: { status: "DELIVERED" } });
    }
    await logActivity("reminder.sent", `Reminded you: "${reminder.label}"`, { type: "Reminder", id: reminderId });

    if (reminder.taskId) {
      await taskService.markReminderSent(reminder.taskId).catch(() => {
        // Task may already be past REMINDER_SENT (e.g. already IN_PROGRESS) —
        // a reminder firing should never crash the pipeline over that.
      });
    }
    await scheduleNextOccurrence(reminder);
    return updated;
  }

  const retryCount = reminder.retryCount + 1;
  const exhausted = retryCount >= MAX_RETRIES;
  const updated = await prisma.reminder.update({
    where: { id: reminderId },
    data: { retryCount, status: exhausted ? "FAILED" : "PENDING" },
  });
  await prisma.reminderLog.create({
    data: { reminderId, eventType: "failed", details: `retry ${retryCount}/${MAX_RETRIES}` },
  });
  if (exhausted) {
    // A failed day must not end a repeating reminder.
    await scheduleNextOccurrence(reminder);
    await logActivity(
      "reminder.failed",
      `Could not deliver the reminder "${reminder.label}" after ${MAX_RETRIES} tries — it is shown in the app.`,
      { type: "Reminder", id: reminderId }
    );
  }
  return updated;
}

/** Called by her phone when it has shown the reminder (spec §10: "logs sent and delivered status"). */
export async function markDelivered(reminderId: string) {
  const claim = await prisma.reminder.updateMany({ where: { id: reminderId, status: "SENT" }, data: { status: "DELIVERED" } });
  if (claim.count > 0) await prisma.reminderLog.create({ data: { reminderId, eventType: "delivered" } });
  return prisma.reminder.findUniqueOrThrow({ where: { id: reminderId } });
}

let checkRunning = false;

/** The every-minute check. A check still running when the next starts is not repeated, so nothing is sent twice. */
export async function runDueReminders(reference: Date = new Date(), notifier: Notifier = new ConsoleNotifier()) {
  if (checkRunning) return [];
  checkRunning = true;
  try {
    return await fireDue(reference, notifier);
  } finally {
    checkRunning = false;
  }
}

async function fireDue(reference: Date, notifier: Notifier) {
  const due = await dueReminders(reference);
  const results = [];
  for (const reminder of due) {
    results.push(await fireReminder(reminder.id, notifier));
  }
  return results;
}

export async function snooze(reminderId: string, minutes: number) {
  const reminder = await prisma.reminder.findUniqueOrThrow({ where: { id: reminderId } });
  const fireAt = new Date(Date.now() + minutes * 60_000);
  const updated = await prisma.reminder.update({
    where: { id: reminderId },
    data: { fireAt, status: "PENDING" },
  });
  await prisma.reminderLog.create({
    data: { reminderId, eventType: "snoozed", details: `${minutes} minutes from now -> ${fireAt.toISOString()}` },
  });
  return updated;
}

export async function delay(reminderId: string, minutes: number) {
  const reminder = await prisma.reminder.findUniqueOrThrow({ where: { id: reminderId } });
  const fireAt = new Date(reminder.fireAt.getTime() + minutes * 60_000);
  const updated = await prisma.reminder.update({
    where: { id: reminderId },
    data: { fireAt, status: "PENDING" },
  });
  await prisma.reminderLog.create({
    data: { reminderId, eventType: "delayed", details: `+${minutes} minutes -> ${fireAt.toISOString()}` },
  });
  return updated;
}

export async function reschedule(reminderId: string, newFireAt: Date) {
  const updated = await prisma.reminder.update({
    where: { id: reminderId },
    data: { fireAt: newFireAt, status: "PENDING" },
  });
  await prisma.reminderLog.create({
    data: { reminderId, eventType: "rescheduled", details: newFireAt.toISOString() },
  });
  return updated;
}
