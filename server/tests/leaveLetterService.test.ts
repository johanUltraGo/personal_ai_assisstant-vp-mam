import { describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../src/db";
import { createApp } from "../src/app";
import { draftLeaveLetter, workingDays } from "../src/services/leaveLetterService";

describe("workingDays", () => {
  it("skips Saturdays and Sundays", () => {
    // Fri 13 Nov 2026 – Mon 16 Nov 2026
    const result = workingDays("2026-11-13", "2026-11-16", new Map());
    expect(result.days).toEqual(["2026-11-13", "2026-11-16"]);
    expect(result.skipped).toEqual([
      { date: "2026-11-14", reason: "Saturday" },
      { date: "2026-11-15", reason: "Sunday" },
    ]);
  });

  it("skips calendar holidays by name", () => {
    const result = workingDays("2026-11-10", "2026-11-12", new Map([["2026-11-11", "Diwali"]]));
    expect(result.days).toEqual(["2026-11-10", "2026-11-12"]);
    expect(result.skipped).toEqual([{ date: "2026-11-11", reason: "Diwali" }]);
  });
});

describe("draftLeaveLetter", () => {
  it("drafts a teacher notice for a range, leaving out the weekend", async () => {
    const letter = await draftLeaveLetter({
      audience: "TEACHER",
      names: ["Mrs. Devi"],
      fromDate: "2026-11-13",
      toDate: "2026-11-16",
      reason: "medical leave",
      schoolName: "Example School",
    });
    expect(letter.subject).toMatch(/Teacher leave notice/);
    expect(letter.body).toContain("Mrs. Devi");
    expect(letter.body).toContain("medical leave");
    expect(letter.body).toContain("2 working days");
    expect(letter.workingDays).toEqual(["2026-11-13", "2026-11-16"]);
  });

  it("uses holidays from the school calendar", async () => {
    await prisma.calendarEvent.create({ data: { eventName: "Diwali", eventDate: new Date("2026-11-11T00:00:00+05:30"), type: "HOLIDAY" } });
    const letter = await draftLeaveLetter({ audience: "STUDENT", names: ["Arun"], fromDate: "2026-11-10", toDate: "2026-11-12" });
    expect(letter.skipped).toContainEqual({ date: "2026-11-11", reason: "Diwali" });
    expect(letter.workingDays).toHaveLength(2);
  });

  it("refuses leave that falls only on non-working days", async () => {
    await expect(draftLeaveLetter({ audience: "TEACHER", names: ["Mr. Ravi"], fromDate: "2026-11-14", toDate: "2026-11-15" })).rejects.toThrow(/no working days/);
  });

  it("limits a student leave notice to one or two named students", async () => {
    await expect(draftLeaveLetter({ audience: "STUDENT", names: ["A", "B", "C"], fromDate: "2026-11-13" })).rejects.toThrow(/one or two/);
  });

  it("works over HTTP", async () => {
    const res = await request(createApp()).post("/api/leave/draft").send({ audience: "TEACHER", names: ["Mrs. Devi"], fromDate: "2026-11-13" });
    expect(res.status).toBe(200);
    expect(res.body.workingDays).toEqual(["2026-11-13"]);
  });
});
