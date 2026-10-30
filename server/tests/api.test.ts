import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

const app = createApp();

function window(hoursFromNow: number) {
  const start = new Date(Date.now() + hoursFromNow * 3600_000);
  const end = new Date(start.getTime() + 30 * 60_000);
  return { timeWindowStart: start.toISOString(), timeWindowEnd: end.toISOString() };
}

describe("task API", () => {
  it("creates a task via POST /api/tasks", async () => {
    const res = await request(app)
      .post("/api/tasks")
      .send({ title: "Call parent", category: "admin", ...window(1) });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("SCHEDULED");
  });

  it("rejects an invalid payload with 400", async () => {
    const res = await request(app).post("/api/tasks").send({ title: "" });
    expect(res.status).toBe(400);
  });

  it("lists tasks via GET /api/tasks", async () => {
    await request(app).post("/api/tasks").send({ title: "Task A", ...window(1) });
    await request(app).post("/api/tasks").send({ title: "Task B", ...window(2) });
    const res = await request(app).get("/api/tasks");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it("completes a task only via explicit POST /api/tasks/:id/complete", async () => {
    const created = await request(app).post("/api/tasks").send({ title: "Finish circular", ...window(1) });
    const completed = await request(app).post(`/api/tasks/${created.body.id}/complete`);
    expect(completed.status).toBe(200);
    expect(completed.body.status).toBe("COMPLETED");
  });

  it("serves today's morning list via GET /api/morning-list/today", async () => {
    await request(app).post("/api/tasks").send({ title: "Morning task", ...window(1) });
    const res = await request(app).get("/api/morning-list/today");
    expect(res.status).toBe(200);
    expect(res.body.tasks.map((t: any) => t.title)).toContain("Morning task");
  });

  it("serves the web UI at /", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Vice Principal AI");
  });
});
