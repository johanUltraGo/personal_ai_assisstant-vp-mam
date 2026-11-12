import { DateTime } from "luxon";
import { prisma } from "../db";
import { schoolTimezone } from "./morningListService";
import { DriveConnector, driveFileIdFrom } from "../connectors/driveConnector";
import { Notifier, ConsoleNotifier } from "../notifiers/notifier";
import { logActivity } from "./activityService";

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
  // Design §6: events from tomorrow up to two days ahead not yet asked about,
  // so a missed 9:00 run still asks one day before instead of never.
  const today = DateTime.fromJSDate(reference, { zone: schoolTimezone() }).startOf("day");
  return prisma.calendarEvent.findMany({
    where: {
      promptedAt: null,
      eventDate: { gte: today.plus({ days: 1 }).toJSDate(), lt: today.plus({ days: 3 }).toJSDate() },
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
  const event = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: eventId } });
  return prisma.calendarEvent.update({
    where: { id: eventId },
    data: {
      promptedAt: event.promptedAt ?? new Date(),
      decision: approved ? "APPROVED" : "DECLINED",
      decidedAt: new Date(),
      notifiedAt: approved ? new Date() : null,
    },
  });
}

export function getEvent(eventId: string) {
  return prisma.calendarEvent.findUniqueOrThrow({ where: { id: eventId } });
}

export interface ImportedCalendarEvent extends SeedEventInput {}

/**
 * Imports the two portable formats schools most commonly provide: an iCalendar
 * (.ics) export or a JSON array of { eventName, eventDate, type } objects.
 * Every event is normalised before storage and a re-sync updates nothing twice.
 */
export function parseCalendarFile(content: string): ImportedCalendarEvent[] {
  const trimmed = content.replace(/^\uFEFF/, "").trim();
  const firstLine = trimmed.split(/\r?\n/, 1)[0].toLowerCase();
  if (!trimmed.startsWith("[") && !/BEGIN:VCALENDAR/i.test(trimmed) && firstLine.includes("date") && firstLine.includes(",")) {
    return parseCsvCalendar(trimmed);
  }
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

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { cells.push(cell.trim()); cell = ""; }
    else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

/** CSV from a Google Sheet export: a header row naming Date, Event/Name/Title and optional Type columns. */
function parseCsvCalendar(text: string): ImportedCalendarEvent[] {
  const [header, ...rows] = text.split(/\r?\n/).filter((l) => l.trim());
  const cols = splitCsvLine(header).map((c) => c.toLowerCase());
  const dateCol = cols.findIndex((c) => c.includes("date"));
  const nameCol = cols.findIndex((c) => /event|name|title|occasion|description/.test(c));
  const typeCol = cols.findIndex((c) => /type|holiday|category/.test(c));
  if (dateCol < 0 || nameCol < 0) throw new Error("The calendar sheet needs a Date column and an Event (or Name) column.");
  return rows.map((row) => {
    const cells = splitCsvLine(row);
    const name = cells[nameCol] ?? "";
    const typeCell = typeCol >= 0 ? cells[typeCol] ?? "" : "";
    const holiday = /holiday|leave|closed/i.test(typeCell) || /holiday/i.test(name);
    return normaliseEvent({ eventName: name, eventDate: cells[dateCol] ?? "", type: holiday ? "HOLIDAY" : "EVENT" });
  });
}

function normaliseEvent(input: { eventName: string; eventDate: string; type?: string }): ImportedCalendarEvent {
  if (!input.eventName.trim() || !input.eventDate.trim()) throw new Error("Each calendar event needs a name and date.");
  const type = input.type?.toUpperCase() === "HOLIDAY" ? "HOLIDAY" : "EVENT";
  // iCalendar all-day dates are YYYYMMDD; preserve the school's local day.
  const raw = input.eventDate.trim();
  const zone = schoolTimezone();
  // Design §7: DD/MM/YYYY (Indian order) or ISO; iCalendar YYYYMMDD.
  const parsed = /^\d{8}$/.test(raw)
    ? DateTime.fromFormat(raw, "yyyyLLdd", { zone })
    : /^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$/.test(raw)
      ? DateTime.fromFormat(raw.replace(/[.-]/g, "/"), "d/M/yyyy", { zone })
      : DateTime.fromISO(raw, { zone }).isValid
        ? DateTime.fromISO(raw, { zone })
        : DateTime.fromFormat(raw, "d LLL yyyy", { zone });
  if (!parsed.isValid) throw new Error(`Invalid calendar date: ${input.eventDate}`);
  return { eventName: input.eventName.trim(), eventDate: parsed.toJSDate(), type };
}

async function storeEvents(events: ImportedCalendarEvent[]) {
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
  return created;
}

/** Calendar file uploaded from the screen (.ics, JSON or CSV) — works without Drive. */
export async function importCalendar(content: string) {
  const events = parseCalendarFile(content);
  const created = await storeEvents(events);
  await logActivity("calendar.imported", `Imported the school calendar: ${events.length} entries, ${created} new.`);
  return { imported: events.length, created };
}

export async function syncCalendarFromDrive(connector: DriveConnector, fileId: string) {
  const file = await connector.readFile(fileId);
  if (file.kind !== "text" || !file.text) {
    throw new Error(`"${file.name}" is not a calendar file I can read (.ics, JSON, CSV or Google Sheet).`);
  }
  const events = parseCalendarFile(file.text);
  const created = await storeEvents(events);
  await logActivity("calendar.synced", `Checked the school calendar "${file.name}": ${events.length} entries, ${created} new.`);
  return { fileName: file.name, imported: events.length, created };
}

/** Spec §6: "checks it every time it runs" — the configured school Drive file. */
export async function syncConfiguredCalendar(connector?: DriveConnector) {
  const configured = process.env.SCHOOL_CALENDAR_FILE_ID?.trim();
  if (!configured) return null;
  const drive = connector ?? (await (await import("../connectors/registry")).driveConnector());
  return syncCalendarFromDrive(drive, driveFileIdFrom(configured));
}

function eventDay(event: { eventDate: Date }) {
  return DateTime.fromJSDate(event.eventDate, { zone: schoolTimezone() }).toFormat("cccc, d LLLL yyyy");
}

/**
 * Spec §6: two days before an event, ask "Shall I send a notification to the
 * parents' group?". Alerts run 9:00 AM–6:00 PM (spec §7); each event is asked
 * about once.
 */
export async function raiseDuePrompts(now: Date = new Date(), notifier: Notifier = new ConsoleNotifier()) {
  const hour = DateTime.fromJSDate(now, { zone: schoolTimezone() }).hour;
  if (hour < 9 || hour >= 18) return [];
  const due = await findEventsNeedingPrompt(now);
  const asked = [];
  for (const event of due) {
    const claim = await prisma.calendarEvent.updateMany({ where: { id: event.id, promptedAt: null }, data: { promptedAt: new Date() } });
    if (claim.count === 0) continue; // another run already asked
    asked.push(event);
    await notifier.send({
      title: `${event.eventName} is coming up`,
      body: `${event.eventName} is on ${eventDay(event)}. Shall I send a notification to the parents' group?`,
      data: { url: "/#alerts-section", eventId: event.id },
    });
    await logActivity("calendar.prompted", `Asked whether to tell the parents' group about ${event.eventName} (${eventDay(event)}).`, {
      type: "CalendarEvent",
      id: event.id,
    });
  }
  return asked;
}

/** Events she was asked about and has not answered yet. */
export function pendingPrompts(now: Date = new Date()) {
  const today = DateTime.fromJSDate(now, { zone: schoolTimezone() }).startOf("day");
  return prisma.calendarEvent.findMany({
    where: { promptedAt: { not: null }, decision: null, eventDate: { gte: today.toJSDate() } },
    orderBy: { eventDate: "asc" },
  });
}

export function eventsBetween(from: Date, to: Date) {
  return prisma.calendarEvent.findMany({ where: { eventDate: { gte: from, lt: to } }, orderBy: { eventDate: "asc" } });
}

/** Ready-made notice for her to edit before "Send?". */
export function draftEventNotice(event: { eventName: string; eventDate: Date; type: string }) {
  const day = DateTime.fromJSDate(event.eventDate, { zone: schoolTimezone() }).toFormat("cccc, d LLLL yyyy");
  const school = process.env.SCHOOL_NAME?.trim() || "the school";
  const body =
    event.type === "HOLIDAY"
      ? `Dear Parents,\n\nPlease note that ${day} is a holiday for ${event.eventName}. The school will remain closed.\n\nRegards,\nVice Principal\n${school}`
      : `Dear Parents,\n\nThis is to inform you that ${event.eventName} will be held on ${day}.\n\nRegards,\nVice Principal\n${school}`;
  return { subject: `${event.eventName} — ${day}`, body };
}
