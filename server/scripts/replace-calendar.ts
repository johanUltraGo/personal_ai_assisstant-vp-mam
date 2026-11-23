/**
 * Loads a new academic year's school calendar, replacing the old one.
 *   npm run calendar:replace -- ../docs/calendar/school-calendar-2026-27.csv
 * Takes a backup first. The file may be CSV (Date,Event,Type), JSON or .ics.
 */
import "dotenv/config";
import { readFileSync } from "fs";

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Give the calendar file: npm run calendar:replace -- path/to/calendar.csv");
  const { prisma } = await import("../src/db");
  const { backupDatabase } = await import("../src/services/backupService");
  const { parseCalendarFile, importCalendar } = await import("../src/services/calendarService");
  const content = readFileSync(file, "utf8");
  const events = parseCalendarFile(content); // fail before deleting anything if the file is bad
  await backupDatabase();
  const removed = await prisma.calendarEvent.deleteMany({});
  const result = await importCalendar(content);
  console.log(`Removed ${removed.count} old entries; loaded ${result.created} of ${events.length}.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
