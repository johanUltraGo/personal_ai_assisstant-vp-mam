import { describe, it, expect } from "vitest";
import { schemaOf } from "./testDatabaseUrl";

describe("test isolation", () => {
  it("never runs against her live data", () => {
    expect(schemaOf(process.env.DATABASE_URL ?? "")).toBe("vp_test");
    expect(process.env.ATTACHMENT_STORAGE_PATH ?? "").toContain("vp-test-uploads");
    expect(process.env.SUPABASE_SECRET_KEY ?? "").toBe("");
  });
});
