import { DateTime } from "luxon";
import { prisma } from "../db";
import { schoolTimezone } from "./morningListService";

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
