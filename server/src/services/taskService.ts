import { prisma } from "../db";
import { ALLOWED_TRANSITIONS, TaskSource, TaskStatus } from "../domain/types";
import { BadRequestError } from "../http/errors";

export class InvalidTransitionError extends Error {
  constructor(from: TaskStatus, to: TaskStatus) {
    super(`Cannot move a task from ${from} to ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  category?: string;
  timeWindowStart: Date;
  timeWindowEnd: Date;
  source?: TaskSource;
}

/**
 * Every transition is logged to TaskHistory with a timestamp (spec §10).
 * `changedBy` defaults to "principal" for user-initiated actions; the
 * scheduler/reminder engine passes "system" explicitly for transitions
 * it is allowed to make on its own (never COMPLETED — see completeTask).
 */
async function applyTransition(
  taskId: string,
  to: TaskStatus,
  changedBy: string,
  note?: string
) {
  return prisma.$transaction(async (tx) => {
    const task = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
    const from = task.status as TaskStatus;
    const allowed = ALLOWED_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      throw new InvalidTransitionError(from, to);
    }
    const updated = await tx.task.update({
      where: { id: taskId },
      data: { status: to },
    });
    await tx.taskHistory.create({
      data: { taskId, fromStatus: from, toStatus: to, changedBy, note },
    });
    return updated;
  });
}

export async function createTask(input: CreateTaskInput) {
  if (input.timeWindowEnd <= input.timeWindowStart) {
    throw new BadRequestError("timeWindowEnd must be after timeWindowStart");
  }
  return prisma.$transaction(async (tx) => {
    const task = await tx.task.create({
      data: {
        title: input.title,
        description: input.description,
        category: input.category,
        timeWindowStart: input.timeWindowStart,
        timeWindowEnd: input.timeWindowEnd,
        source: input.source ?? "MANUAL",
        status: "DRAFTED",
      },
    });
    await tx.taskHistory.create({
      data: { taskId: task.id, fromStatus: null, toStatus: "DRAFTED", changedBy: "principal" },
    });
    // Manual entry supplies a concrete time window up front, so the task
    // moves straight on to SCHEDULED — both transitions are logged
    // separately so the audit trail shows drafted-then-scheduled, per
    // the task-state list in spec §10.
    const scheduled = await tx.task.update({
      where: { id: task.id },
      data: { status: "SCHEDULED" },
    });
    await tx.taskHistory.create({
      data: { taskId: task.id, fromStatus: "DRAFTED", toStatus: "SCHEDULED", changedBy: "principal" },
    });
    return scheduled;
  });
}

export async function listTasks(filter?: { from?: Date; to?: Date; status?: TaskStatus }) {
  return prisma.task.findMany({
    where: {
      status: filter?.status,
      timeWindowStart: filter?.from ? { gte: filter.from } : undefined,
      timeWindowEnd: filter?.to ? { lte: filter.to } : undefined,
    },
    orderBy: { timeWindowStart: "asc" },
  });
}

export async function getTask(taskId: string) {
  return prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: { history: { orderBy: { changedAt: "asc" } } },
  });
}

export async function startTask(taskId: string) {
  return applyTransition(taskId, "IN_PROGRESS", "principal");
}

/**
 * The assistant must never mark a task done by itself (spec §10) — this
 * is the ONLY function that can move a task to COMPLETED, and it always
 * logs "principal" as the actor. There is no system/automated caller of
 * this function anywhere in the codebase.
 */
export async function completeTask(taskId: string, note?: string) {
  return applyTransition(taskId, "COMPLETED", "principal", note);
}

/** Her decision to drop a task (design §3.3). History is kept; nothing is deleted. */
export async function cancelTask(taskId: string, reason?: string) {
  return applyTransition(taskId, "CANCELLED", "principal", reason ? `Cancelled: ${reason}` : "Cancelled");
}

/**
 * Re-titles or re-times a task (e.g. her morning reply "move the staff
 * meeting to 3"). Not a state change, so it is logged as a same-status
 * history row with a note saying what moved.
 */
export async function updateTask(
  taskId: string,
  changes: { title?: string; timeWindowStart?: Date; timeWindowEnd?: Date },
  changedBy = "principal"
) {
  return prisma.$transaction(async (tx) => {
    const task = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
    if (task.status === "COMPLETED" || task.status === "CANCELLED") {
      throw new InvalidTransitionError(task.status as TaskStatus, task.status as TaskStatus);
    }
    const start = changes.timeWindowStart ?? task.timeWindowStart;
    const end = changes.timeWindowEnd ?? task.timeWindowEnd;
    if (end <= start) throw new BadRequestError("timeWindowEnd must be after timeWindowStart");
    const updated = await tx.task.update({
      where: { id: taskId },
      data: { title: changes.title?.trim() || task.title, timeWindowStart: start, timeWindowEnd: end },
    });
    const notes: string[] = [];
    if (changes.title && changes.title.trim() !== task.title) notes.push(`renamed from "${task.title}"`);
    if (start.getTime() !== task.timeWindowStart.getTime() || end.getTime() !== task.timeWindowEnd.getTime()) {
      notes.push(`window ${task.timeWindowStart.toISOString()}–${task.timeWindowEnd.toISOString()} → ${start.toISOString()}–${end.toISOString()}`);
    }
    await tx.taskHistory.create({
      data: { taskId, fromStatus: task.status, toStatus: task.status, changedBy, note: `Moved/edited: ${notes.join("; ") || "no change"}` },
    });
    return updated;
  });
}

/** Called by the scheduler (system actor) when a reminder fires for a task. */
export async function markReminderSent(taskId: string) {
  return applyTransition(taskId, "REMINDER_SENT", "system");
}

/** Called by the scheduler (system actor) when a task's window has passed, unfinished. */
export async function markOverdue(taskId: string) {
  return applyTransition(taskId, "OVERDUE", "system", "Time window passed without completion");
}

/**
 * Carries an unfinished task into a new day's time window (same time-of-day,
 * shifted by `dayOffsetMs`), per spec §10 ("Unfinished tasks carry over to
 * the next day's plan"). Logged as its own transition with carriedOverCount
 * incremented so the history shows exactly how many times a task has slipped.
 */
export async function carryForward(taskId: string, newStart: Date, newEnd: Date, fromDateLabel: string) {
  return prisma.$transaction(async (tx) => {
    const task = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
    const from = task.status as TaskStatus;
    const allowed = ALLOWED_TRANSITIONS[from] ?? [];
    if (!allowed.includes("SCHEDULED")) {
      throw new InvalidTransitionError(from, "SCHEDULED");
    }
    const updated = await tx.task.update({
      where: { id: taskId },
      data: {
        status: "SCHEDULED",
        timeWindowStart: newStart,
        timeWindowEnd: newEnd,
        carriedOverCount: { increment: 1 },
      },
    });
    await tx.taskHistory.create({
      data: {
        taskId,
        fromStatus: from,
        toStatus: "SCHEDULED",
        changedBy: "system",
        note: `Carried over from ${fromDateLabel} (unfinished)`,
      },
    });
    return updated;
  });
}
