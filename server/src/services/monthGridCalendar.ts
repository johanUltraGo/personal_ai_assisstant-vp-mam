import { DateTime } from "luxon";

/**
 * The school's Excel academic calendar: one sheet per wing, each a run of
 * month blocks. A block starts with a header row
 *   Month | Sun | Mon | … | Sat | Term | Particulars | Working days | Theme
 * followed by week rows of day numbers, with the month's events written in
 * "Particulars" as "11th- School reopens", "20th & 21st - Diwali Holidays",
 * "14,21,28th - Internship" or "22nd Term II Vacation Begins".
 *
 * The academic year runs June to May. Which year a sheet is for comes from
 * its own grid: the weekday column of June's day 1. Every event is labelled
 * with its wing (the sheet name), e.g. "i Lead: Sports Day".
 */
export interface GridEvent {
  eventName: string;
  eventDate: string; // YYYY-MM-DD
  type: "HOLIDAY" | "EVENT";
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const JUNE = 5;
// Exact weekday headings only, so "Month" is never mistaken for "Mon".
const WEEKDAY_HEADING = /^(sun|sunday|mon|monday|tue|tues|tuesday|wed|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday)$/i;

export function isMonthGridWorkbook(text: string): boolean {
  return /^### Sheet: /m.test(text) && /^\s*Month\t\s*Sun\t/im.test(text) && /Particulars/i.test(text);
}

export function parseMonthGridWorkbook(text: string, today: Date = new Date()): GridEvent[] {
  const events: GridEvent[] = [];
  const seen = new Set<string>();
  for (const block of text.split(/^### Sheet: /m).slice(1)) {
    const [nameLine, ...lines] = block.split(/\r?\n/);
    const wing = nameLine.trim();
    for (const e of parseSheet(wing, lines.map((l) => l.split("\t")), today)) {
      const key = `${e.eventDate}|${e.eventName}`;
      if (!seen.has(key)) {
        seen.add(key);
        events.push(e);
      }
    }
  }
  return events;
}

function parseSheet(wing: string, rows: string[][], today: Date): GridEvent[] {
  // Find the month blocks, the Particulars column and the weekday columns.
  type Block = { month: number; particulars: string[]; firstWeek?: string[]; dayCols: number[] };
  const blocks: Block[] = [];
  let partCol = -1;
  let dayCols: number[] = [];
  let current: Block | null = null;
  for (const row of rows) {
    const first = (row[0] ?? "").trim().toLowerCase();
    if (first === "month") {
      partCol = row.findIndex((c) => /particulars/i.test(c));
      dayCols = row.map((c, i) => (WEEKDAY_HEADING.test(c.trim()) ? i : -1)).filter((i) => i >= 0);
      const month = blocks.length ? (blocks[blocks.length - 1].month + 1) % 12 : JUNE;
      current = { month, particulars: [], dayCols };
      blocks.push(current);
      continue;
    }
    if (!current || partCol < 0) continue;
    const named = MONTHS.indexOf(first);
    if (named >= 0) current.month = named;
    if (!current.firstWeek && dayCols.some((c) => /^\d{1,2}$/.test((row[c] ?? "").trim()))) current.firstWeek = row;
    const cell = (row[partCol] ?? "").trim();
    if (cell) current.particulars.push(...cell.split(" | ").map((p) => p.trim()).filter(Boolean));
  }
  if (!blocks.length) return [];

  const startYear = academicStartYear(blocks.find((b) => b.month === JUNE), today);
  const out: GridEvent[] = [];
  for (const block of blocks) {
    const year = block.month >= JUNE ? startYear : startYear + 1;
    for (const line of block.particulars) {
      const parsed = parseParticular(line);
      if (!parsed) continue;
      for (const day of parsed.days) {
        const date = DateTime.fromObject({ year, month: block.month + 1, day });
        if (!date.isValid) continue;
        out.push({
          eventName: `${wing}: ${parsed.name}`,
          eventDate: date.toISODate()!,
          type: /holiday|vacation/i.test(parsed.name) ? "HOLIDAY" : "EVENT",
        });
      }
    }
  }
  return out;
}

/** June's day 1 sits under one weekday; pick the year (near today) where June 1 is that weekday. */
function academicStartYear(june: { firstWeek?: string[]; dayCols: number[] } | undefined, today: Date): number {
  const now = DateTime.fromJSDate(today);
  const fallback = now.month >= 6 ? now.year : now.year - 1;
  if (!june?.firstWeek) return fallback;
  const position = june.dayCols.findIndex((c) => (june.firstWeek![c] ?? "").trim() === "1");
  if (position < 0) return fallback;
  const candidates: number[] = [];
  for (let y = fallback - 4; y <= fallback + 2; y++) if (DateTime.fromObject({ year: y, month: 6, day: 1 }).weekday % 7 === position) candidates.push(y);
  if (!candidates.length) return fallback;
  return candidates.reduce((best, y) => (Math.abs(y - fallback) < Math.abs(best - fallback) ? y : best));
}

// A day: "20", "20th", "20 th", "11thsept", "12th dec" (the month word is the block's own month).
const MONTH_WORD = String.raw`(?:\s?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b)?`;
const DAY = String.raw`\d{1,2}(?:\s?(?:st|nd|rd|th)(?=\b|[a-z]))?${MONTH_WORD}`;
// Between days: "," "&" "and" "to", or a dash used as "to" ("14th - 16th Pongal Holidays").
const JOIN = String.raw`\s*(?:,|&|and|to|[-–—](?=\s*\d))\s*`;
const DAYS = new RegExp(String.raw`^\s*(${DAY}(?:${JOIN}${DAY})*)\s*(?:[-–—:]+\s*|\s+(?=[A-Za-z]))(.+)$`, "i");

/** "20th & 21st - Diwali Holidays" -> days [20, 21], name "Diwali Holidays". */
export function parseParticular(line: string): { days: number[]; name: string } | null {
  const match = line.match(DAYS);
  if (!match) return null;
  const name = match[2].replace(/\s+/g, " ").trim();
  if (!name) return null;
  const numbers = (match[1].match(/\d{1,2}/g) ?? []).map(Number);
  let days = numbers;
  if (/\bto\b|\d\D*[-–—]\s*\d/i.test(match[1]) && numbers.length === 2 && numbers[0] < numbers[1]) {
    days = Array.from({ length: numbers[1] - numbers[0] + 1 }, (_, i) => numbers[0] + i);
  }
  days = [...new Set(days)].filter((d) => d >= 1 && d <= 31);
  return days.length ? { days, name } : null;
}
