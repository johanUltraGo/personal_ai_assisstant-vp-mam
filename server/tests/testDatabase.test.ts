import { describe, it, expect } from "vitest";

describe("test isolation", () => {
  it("never runs against the live dev.db", () => {
    expect(process.env.DATABASE_URL).toBe("file:./test.db");
    expect(process.env.ATTACHMENT_STORAGE_PATH ?? "").toContain("vp-test-uploads");
  });
});
