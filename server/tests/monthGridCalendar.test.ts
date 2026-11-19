import { describe, it, expect } from "vitest";
import { parseParticular, parseMonthGridWorkbook } from "../src/services/monthGridCalendar";

describe("school Excel month calendar", () => {
  it.each([
    ["11th- School reopens", [11], "School reopens"],
    ["20th & 21st  - Diwali Holidays", [20, 21], "Diwali Holidays"],
    ["14,21,28th - Internship program", [14, 21, 28], "Internship program"],
    ["8th -Sports Day", [8], "Sports Day"],
    ["22nd Term II Vacation Begins", [22], "Term II Vacation Begins"],
    ["19th & 20 th  - Term II ILP- Achievements Meet", [19, 20], "Term II ILP- Achievements Meet"],
    ["14th - 16th Pongal Holidays", [14, 15, 16], "Pongal Holidays"],
    ["11thsept to  18thsept - Term 1 Assessment", [11, 12, 13, 14, 15, 16, 17, 18], "Term 1 Assessment"],
    ["4thdec to 12th dec - Term II Assessment", [4, 5, 6, 7, 8, 9, 10, 11, 12], "Term II Assessment"],
  ])("reads %s", (line, days, name) => {
    expect(parseParticular(line)).toEqual({ days, name });
  });

  it("leaves rules that are not dates alone", () => {
    expect(parseParticular("Grade 8 all saturdays holiday.")).toBeNull();
  });

  it("dates each wing from its own grid (June 1 on a Sunday = 2025, on a Monday = 2026) and labels the wing", () => {
    const sheet = (name: string, juneFirstWeek: string) =>
      [
        `### Sheet: ${name}`,
        "Month\tSun\tMon\tTues\tWed\tThurs\tFri\tSat\tTerm\tParticulars\tWorking days",
        `June\t${juneFirstWeek}\tTerm 1\t11th- School reopens\t14`,
        "Month\tSun\tMon\tTues\tWed\tThurs\tFri\tSat\tTerm\tParticulars",
        "July\t\t\t1\t2\t3\t4\t5\tTerm 1\t4th- Costume day",
        "Month\tSun\tMon\tTues\tWed\tThurs\tFri\tSat\tTerm\tParticulars",
        "\t\t\t\t\t\t1\t2\t\t8th -Sports Day | 9th-Raksha Bandhan Holiday",
      ].join("\n");
    const text = [sheet("iDiscover", "1\t2\t3\t4\t5\t6\t7"), sheet("i discover new", "\t1\t2\t3\t4\t5\t6")].join("\n\n");
    const events = parseMonthGridWorkbook(text, new Date("2026-11-19T00:00:00Z"));
    expect(events).toEqual(
      expect.arrayContaining([
        { eventName: "iDiscover: School reopens", eventDate: "2025-06-11", type: "EVENT" },
        { eventName: "iDiscover: Costume day", eventDate: "2025-07-04", type: "EVENT" },
        { eventName: "iDiscover: Sports Day", eventDate: "2025-08-08", type: "EVENT" },
        { eventName: "iDiscover: Raksha Bandhan Holiday", eventDate: "2025-08-09", type: "HOLIDAY" },
        { eventName: "i discover new: School reopens", eventDate: "2026-06-11", type: "EVENT" },
      ])
    );
    expect(events).toHaveLength(8);
  });
});
