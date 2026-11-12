import { DateTime } from "luxon";
import { prisma } from "../db";
import { BadRequestError } from "../http/errors";
import { schoolTimezone } from "./morningListService";

export type LeaveAudience = "TEACHER" | "STUDENT";

export interface LeaveLetterInput {
  audience: LeaveAudience;
  names: string[];
  fromDate: string; // YYYY-MM-DD
  toDate?: string; // YYYY-MM-DD, defaults to fromDate
  reason?: string;
  schoolName?: string;
}

/**
 * Spec §6: "Saturdays, Sundays and other holidays in the calendar are used
 * when planning leave." Returns the working days in the range and the days
 * left out, with the reason for each.
 */
export function workingDays(from: string, to: string, holidays: Map<string, string>) {
  const zone = schoolTimezone();
  const start = DateTime.fromISO(from, { zone });
  const end = DateTime.fromISO(to, { zone });
  if (!start.isValid || !end.isValid) throw new BadRequestError("Leave dates must be YYYY-MM-DD.");
  if (end < start) throw new BadRequestError("The leave must end on or after the day it starts.");
  if (end.diff(start, "days").days > 60) throw new BadRequestError("Leave notices cover at most 60 days.");

  const days: string[] = [];
  const skipped: { date: string; reason: string }[] = [];
  for (let day = start; day <= end; day = day.plus({ days: 1 })) {
    const iso = day.toISODate()!;
    if (day.weekday === 6) skipped.push({ date: iso, reason: "Saturday" });
    else if (day.weekday === 7) skipped.push({ date: iso, reason: "Sunday" });
    else if (holidays.has(iso)) skipped.push({ date: iso, reason: holidays.get(iso)! });
    else days.push(iso);
  }
  return { days, skipped };
}

async function holidaysBetween(from: string, to: string): Promise<Map<string, string>> {
  const zone = schoolTimezone();
  const events = await prisma.calendarEvent.findMany({
    where: {
      type: "HOLIDAY",
      eventDate: {
        gte: DateTime.fromISO(from, { zone }).startOf("day").toJSDate(),
        lt: DateTime.fromISO(to, { zone }).plus({ days: 1 }).startOf("day").toJSDate(),
      },
    },
  });
  return new Map(events.map((e) => [DateTime.fromJSDate(e.eventDate, { zone }).toISODate()!, e.eventName]));
}

function formatDay(iso: string) {
  return DateTime.fromISO(iso, { zone: schoolTimezone() }).toFormat("d LLLL yyyy");
}

/**
 * Drafts a reviewable leave notice. It never sends: the text goes through the
 * normal prepare → "Send?" flow before anything leaves.
 */
export async function draftLeaveLetter(input: LeaveLetterInput) {
  const names = input.names.map((n) => n.trim()).filter(Boolean);
  if (!names.length) throw new BadRequestError("At least one named teacher or student is required.");
  if (input.audience === "STUDENT" && names.length > 2) {
    throw new BadRequestError("Student leave notices are limited to one or two named students.");
  }
  const to = input.toDate ?? input.fromDate;
  const { days, skipped } = workingDays(input.fromDate, to, await holidaysBetween(input.fromDate, to));
  if (!days.length) {
    throw new BadRequestError("Those dates have no working days — they are all weekends or school holidays.");
  }

  const who = names.join(", ");
  const period =
    days.length === 1
      ? `on ${formatDay(days[0])}`
      : `from ${formatDay(input.fromDate)} to ${formatDay(to)} (${days.length} working days)`;
  const skippedNote = skipped.length
    ? `\n\n(${skipped.map((s) => `${formatDay(s.date)} is ${s.reason === "Saturday" || s.reason === "Sunday" ? "a " + s.reason : s.reason}`).join("; ")} — not counted.)`
    : "";
  const reason = input.reason?.trim() ? ` Reason: ${input.reason.trim()}.` : "";
  const organisation = input.schoolName?.trim() || process.env.SCHOOL_NAME?.trim() || "the school";
  const dateLabel = days.length === 1 ? formatDay(days[0]) : `${formatDay(input.fromDate)} – ${formatDay(to)}`;

  const body =
    input.audience === "TEACHER"
      ? `Dear Teachers,\n\n${who} will be on leave ${period}.${reason}${skippedNote}\n\nPlease make the necessary academic and duty arrangements.\n\nRegards,\nVice Principal\n${organisation}`
      : `Dear Parent/Guardian,\n\nThis is to record that ${who} will be on leave ${period}.${reason}${skippedNote}\n\nRegards,\nVice Principal\n${organisation}`;
  return {
    subject: `${input.audience === "TEACHER" ? "Teacher" : "Student"} leave notice — ${dateLabel}`,
    body,
    workingDays: days,
    skipped,
  };
}
