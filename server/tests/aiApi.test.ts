import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

const app = createApp();

describe("ai API", () => {
  let original: string | undefined;
  beforeEach(() => {
    original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => {
    if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
  });

  it("returns 503 with a clear blocker when ANTHROPIC_API_KEY is not configured", async () => {
    const res = await request(app).post("/api/ai/parse-task").send({ text: "remind me to call the auditor" });
    expect(res.status).toBe(503);
    expect(res.body.blocked).toBe("ANTHROPIC_API_KEY");
  });

  it("rejects an empty text payload with 400", async () => {
    const res = await request(app).post("/api/ai/parse-task").send({ text: "" });
    expect(res.status).toBe(400);
  });
});
