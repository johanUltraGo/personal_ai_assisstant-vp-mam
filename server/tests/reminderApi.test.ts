import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

const app = createApp();

describe("reminder API", () => {
  it("creates a reminder via POST /api/reminders", async () => {
    const res = await request(app)
      .post("/api/reminders")
      .send({ label: "Call the auditor", fireAt: new Date(Date.now() + 3600_000).toISOString() });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("PENDING");
  });

  it("rejects a reminder with no label", async () => {
    const res = await request(app).post("/api/reminders").send({ fireAt: new Date().toISOString() });
    expect(res.status).toBe(400);
  });

  it("snoozes an already-due reminder to fire again N minutes from now", async () => {
    // Snooze is relative to "now", not to the original fireAt — pushing
    // out an already-due reminder is the actual use case.
    const created = await request(app)
      .post("/api/reminders")
      .send({ label: "Check inventory", fireAt: new Date(Date.now() - 1000).toISOString() });

    const beforeSnooze = Date.now();
    const snoozed = await request(app).post(`/api/reminders/${created.body.id}/snooze`).send({ minutes: 15 });
    expect(snoozed.status).toBe(200);
    expect(snoozed.body.status).toBe("PENDING");
    expect(new Date(snoozed.body.fireAt).getTime()).toBeGreaterThan(beforeSnooze);
  });

  it("returns a reminder's log via GET /api/reminders/:id", async () => {
    const created = await request(app)
      .post("/api/reminders")
      .send({ label: "Draft notice", fireAt: new Date(Date.now() + 3600_000).toISOString() });
    const fetched = await request(app).get(`/api/reminders/${created.body.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.log[0].eventType).toBe("created");
  });
});
