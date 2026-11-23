import { DateTime } from "luxon";
import { prisma } from "../db";
import { GmailConnector } from "../connectors/gmailConnector";
import { Notifier } from "../notifiers/notifier";
import { schoolTimezone } from "./morningListService";

/** Warn this many days before the last date in the school calendar. */
export const EXPIRY_WARN_DAYS = 30;
/** Repeat the warning at most once a week until a new calendar is loaded. */
const REPEAT_DAYS = 7;

/**
 * The school publishes a new file each academic year (e.g. 2027-28) rather
 * than updating the old one. When the loaded calendar is about to run out,
 * tell her by email (to her own connected Gmail) and by phone notification,
 * so the new file can be shared before alerts stop.
 */
export async function warnIfCalendarEnding(gmail: GmailConnector, notifier: Notifier, now: Date = new Date()): Promise<"sent" | "not_due" | "already_warned" | "empty"> {
  const last = await prisma.calendarEvent.findFirst({ orderBy: { eventDate: "desc" } });
  if (!last) return "empty";
  const zone = schoolTimezone();
  const today = DateTime.fromJSDate(now, { zone }).startOf("day");
  const end = DateTime.fromJSDate(last.eventDate, { zone }).startOf("day");
  const daysLeft = Math.round(end.diff(today, "days").days);
  if (daysLeft > EXPIRY_WARN_DAYS) return "not_due";

  const recent = await prisma.activityLog.findFirst({
    where: { kind: "calendar.expiry_warned", at: { gte: today.minus({ days: REPEAT_DAYS }).toJSDate() } },
  });
  if (recent) return "already_warned";

  const endText = end.toFormat("d LLLL yyyy");
  const when = daysLeft > 0 ? `ends in ${daysLeft} day(s), on ${endText}` : `ended on ${endText}`;
  const body =
    `Dear Ma'am,\n\nThe school calendar loaded in your assistant ${when} (last entry: "${last.eventName}").\n\n` +
    `Please send the new academic year's calendar (PDF, Excel or Google Sheet) so event and holiday alerts continue. ` +
    `Until it is loaded, the assistant has no school events after ${endText}.\n\nYour assistant`;

  if (gmail.health().configured && gmail.accountLabel.includes("@")) {
    try {
      await gmail.send({ to: gmail.accountLabel, subject: "School calendar is ending: please share the new one", body });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[calendar] expiry email failed:", (err as Error).message);
    }
  }
  await notifier.send({ title: "School calendar is ending", body: `The calendar ${when}. Please share the new year's calendar.`, data: { url: "/#more" } });
  await prisma.activityLog.create({ data: { at: now, kind: "calendar.expiry_warned", summary: `Told you the school calendar ${when}.` } });
  return "sent";
}
