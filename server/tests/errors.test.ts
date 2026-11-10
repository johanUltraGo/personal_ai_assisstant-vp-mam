import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

const app = createApp();

describe("central error handling", () => {
  it("returns 404 for an unknown reminder and keeps serving", async () => {
    const res = await request(app).post("/api/reminders/nope/snooze").send({ minutes: 5 });
    expect(res.status).toBe(404);
    const health = await request(app).get("/health");
    expect(health.status).toBe(200);
  });

  it("returns 404 when completing an unknown task", async () => {
    const res = await request(app).post("/api/tasks/nope/complete");
    expect(res.status).toBe(404);
  });

  it("returns 400 for a malformed JSON body", async () => {
    const res = await request(app)
      .post("/api/tasks")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
  });

  it("zod validation error returns 400 with field errors", async () => {
    const res = await request(app).post("/api/tasks").send({});
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.error)).toContain("title");
  });
});
