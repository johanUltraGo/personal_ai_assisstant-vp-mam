import { describe, expect, it } from "vitest";
import { draftLeaveLetter } from "../src/services/leaveLetterService";

describe("draftLeaveLetter", () => {
  it("creates a reviewable teacher notice without sending it", () => {
    const letter = draftLeaveLetter({
      audience: "TEACHER",
      names: ["Mrs. Devi"],
      leaveDate: new Date("2026-11-06T00:00:00+05:30"),
      reason: "medical leave",
      schoolName: "Example School",
    });
    expect(letter.subject).toMatch(/Teacher leave notice/);
    expect(letter.body).toContain("Mrs. Devi");
    expect(letter.body).toContain("medical leave");
  });

  it("limits a student leave notice to one or two named students", () => {
    expect(() => draftLeaveLetter({
      audience: "STUDENT", names: ["A", "B", "C"], leaveDate: new Date(),
    })).toThrow(/one or two/);
  });
});
