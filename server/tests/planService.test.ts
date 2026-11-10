import { describe, it, expect } from "vitest";
import request from "supertest";
import { prisma } from "../src/db";
import { createApp } from "../src/app";
import { proposePlan, savePlan, discardPlan } from "../src/services/planService";
import { startConversation } from "../src/assistant/agent";

const items = [
  { title: "Check exam papers", category: "exams", start: "2026-11-11T10:00:00+05:30", end: "2026-11-11T11:00:00+05:30" },
  { title: "Parents meeting", start: "2026-11-11T15:00:00+05:30", end: "2026-11-11T15:30:00+05:30" },
];

describe("evening plan proposals", () => {
  it("saves a proposal as scheduled tasks with drafted-then-scheduled history", async () => {
    const convo = await startConversation("EVENING_PLAN");
    const plan = await proposePlan(convo.id, "2026-11-11", items);
    const saved = await savePlan(plan.id);
    expect(saved.tasks).toHaveLength(2);
    const history = await prisma.taskHistory.findMany({ where: { taskId: saved.tasks[0].id }, orderBy: { changedAt: "asc" } });
    expect(history.map((h) => h.toStatus)).toEqual(["DRAFTED", "SCHEDULED"]);
    expect(saved.tasks[0].source).toBe("VOICE");
    await expect(savePlan(plan.id)).rejects.toThrow(/already/);
  });

  it("uses her edits instead of the proposal", async () => {
    const plan = await proposePlan(null, "2026-11-11", items);
    const saved = await savePlan(plan.id, [{ title: "Only this", start: "2026-11-11T09:00:00+05:30", end: "2026-11-11T09:30:00+05:30" }]);
    expect(saved.tasks.map((t) => t.title)).toEqual(["Only this"]);
  });

  it("refuses an item that ends before it starts", async () => {
    const plan = await proposePlan(null, "2026-11-11", items);
    await expect(savePlan(plan.id, [{ title: "Bad", start: "2026-11-11T10:00:00+05:30", end: "2026-11-11T09:00:00+05:30" }])).rejects.toThrow(/after/);
    expect(await prisma.task.count()).toBe(0);
  });

  it("a newer proposal in the same conversation replaces the older draft", async () => {
    const convo = await startConversation("EVENING_PLAN");
    const first = await proposePlan(convo.id, "2026-11-11", items);
    await proposePlan(convo.id, "2026-11-11", items.slice(0, 1));
    expect((await prisma.dayPlanProposal.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("DISCARDED");
  });

  it("works over HTTP", async () => {
    const app = createApp();
    const plan = await proposePlan(null, "2026-11-11", items);
    expect((await request(app).get(`/api/plans/${plan.id}`)).body.items).toHaveLength(2);
    expect((await request(app).post(`/api/plans/${plan.id}/save`).send({})).body.tasks).toHaveLength(2);
    const other = await proposePlan(null, "2026-11-12", items);
    await discardPlan(other.id);
    expect((await request(app).post(`/api/plans/${other.id}/save`).send({})).status).toBe(400);
  });
});
