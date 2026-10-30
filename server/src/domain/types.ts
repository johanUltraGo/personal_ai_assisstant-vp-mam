// Application-level enums, since the SQLite dev datasource stores these
// as plain strings (see prisma/schema.prisma). Keep these in sync with
// any Postgres migration that reintroduces real DB enums.

export const TASK_STATUSES = [
  "DRAFTED",
  "SCHEDULED",
  "REMINDER_SENT",
  "IN_PROGRESS",
  "COMPLETED",
  "OVERDUE",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_SOURCES = ["MANUAL", "TYPED", "VOICE"] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

export const REMINDER_STATUSES = ["PENDING", "SENT", "DELIVERED", "FAILED"] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

/**
 * Allowed task state transitions, per planning.md §2.2 / spec §10.
 * The assistant never transitions a task into COMPLETED on its own —
 * every caller of applyTransition for COMPLETED must originate from an
 * explicit user action (enforced by requiring `changedBy` to be a real
 * actor id, never "system", for that specific transition — see
 * taskService.completeTask).
 */
export const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  DRAFTED: ["SCHEDULED"],
  SCHEDULED: ["REMINDER_SENT", "IN_PROGRESS", "COMPLETED", "OVERDUE"],
  REMINDER_SENT: ["IN_PROGRESS", "COMPLETED", "OVERDUE"],
  IN_PROGRESS: ["COMPLETED", "OVERDUE"],
  OVERDUE: ["IN_PROGRESS", "COMPLETED", "SCHEDULED"], // SCHEDULED = carried over to a new day
  COMPLETED: [],
};
