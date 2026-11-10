import { DateTime } from "luxon";
import { prisma } from "../db";
import { schoolTimezone } from "./morningListService";
import { DriveConnector } from "../connectors/driveConnector";

export interface SeedEventInput {
  eventName: string;
  eventDate: Date;
  type: "HOLIDAY" | "EVENT";
}

/**
 * Normally populated by syncing the school calendar file in Drive
 * (spec §6: "checked every time it runs") — that sync is blocked
 * without a configured Drive connector (see driveConnector.ts), so for
 * now events are seeded directly (manually, or by whatever import step
 * replaces this once Drive access is unblocked).
 */
export async function seedEvent(input: SeedEventInput) {
  return prisma.calendarEvent.create({ data: input });
}

/**
 * Finds events exactly two calendar days out that haven't been prompted
 * about yet (spec §6: "Two days before an event... the assistant asks").
 * Comparing whole calendar days (not a fixed hour window) keeps this
 * correct regardless of what time of day the job happens to run.
 */
export async function findEventsNeedingPrompt(reference: Date = new Date()) {
  const today = DateTime.fromJSDate(reference, { zone: schoolTimezone() }).startOf("day");
  const targetDay = today.plus({ days: 2 });
  const nextDay = targetDay.plus({ days: 1 });

  return prisma.calendarEvent.findMany({
    where: {
      promptedAt: null,
      eventDate: { gte: targetDay.toJSDate(), lt: nextDay.toJSDate() },
    },
    orderBy: { eventDate: "asc" },
  });
}

export async function markPrompted(eventId: string) {
  return prisma.calendarEvent.update({ where: { id: eventId }, data: { promptedAt: new Date() } });
}

/**
 * Her yes/no answer to "Shall I send a notification to the parents'
 * group?" (spec §6). This function only records the decision and marks
 * the event notified on "yes" — it does not itself send; the caller
 * (the API route) is responsible for actually sending via
 * messagingService, using the exact same single-confirmation send path
 * as every other outbound message, and only then calling this with
 * approved=true.
 */
export async function recordDecision(eventId: string, approved: boolean) {
  return prisma.calendarEvent.update({
    where: { id: eventId },
    data: { promptedAt: new Date(), notifiedAt: approved ? new Date() : null },
  });
}

export interface ImportedCalendarEvent extends SeedEventInput {}

/**
 * Imports the two portable formats schools most commonly provide: an iCalendar
 * (.ics) export or a JSON array of { eventName, eventDate, type } objects.
 * Every event is normalised before storage and a re-sync updates nothing twice.
 */
export function parseCalendarFile(content: string): ImportedCalendarEvent[] {
  const trimmed = content.trim();
  if (trimmed.startsWith("[")) {
    const entries = JSON.parse(trimmed) as Array<{ eventName?: string; summary?: string; eventDate?: string; date?: string; type?: string }>;
    return entries.map((entry) => normaliseEvent({
      eventName: entry.eventName ?? entry.summary ?? "",
      eventDate: entry.eventDate ?? entry.date ?? "",
      type: entry.type,
    }));
  }

  const blocks = trimmed.split(/BEGIN:VEVENT\r?\n/i).slice(1);
  if (!blocks.length) throw new Error("The school calendar must be an .ics file or a JSON event list.");
  return blocks.map((block) => {
    const summary = block.match(/^SUMMARY(?:;[^:]*)?:(.+)$/im)?.[1]?.trim() ?? "";
    const date = block.match(/^DTSTART(?:;[^:]*)?:(.+)$/im)?.[1]?.trim() ?? "";
    const upper = summary.toUpperCase();
    return normaliseEvent({ eventName: summary, eventDate: date, type: upper.includes("HOLIDAY") ? "HOLIDAY" : "EVENT" });
  });
}

function normaliseEvent(input: { eventName: string; eventDate: string; type?: string }): ImportedCalendarEvent {
  if (!input.eventName.trim() || !input.eventDate.trim()) throw new Error("Each calendar event needs a name and date.");
  const type = input.type?.toUpperCase() === "HOLIDAY" ? "HOLIDAY" : "EVENT";
  // iCalendar all-day dates are YYYYMMDD; preserve the school's local day.
  const parsed = /^\d{8}$/.test(input.eventDate)
    ? DateTime.fromFormat(input.eventDate, "yyyyLLdd", { zone: schoolTimezone() })
    : DateTime.fromISO(input.eventDate, { zone: schoolTimezone() });
  if (!parsed.isValid) throw new Error(`Invalid calendar date: ${input.eventDate}`);
  return { eventName: input.eventName.trim(), eventDate: parsed.toJSDate(), type };
}

export async function syncCalendarFromDrive(connector: DriveConnector, fileId: string) {
  const file = await connector.readFile(fileId);
  const events = parseCalendarFile(file.content);
  let created = 0;
  for (const event of events) {
    const start = DateTime.fromJSDate(event.eventDate, { zone: schoolTimezone() }).startOf("day");
    const end = start.plus({ days: 1 });
    const exists = await prisma.calendarEvent.findFirst({
      where: { eventName: event.eventName, type: event.type, eventDate: { gte: start.toJSDate(), lt: end.toJSDate() } },
    });
    if (!exists) {
      await seedEvent(event);
      created += 1;
    }
  }
  return { fileName: file.name, imported: events.length, created };
}
