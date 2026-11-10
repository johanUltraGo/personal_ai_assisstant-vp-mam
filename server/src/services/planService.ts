import { z } from "zod";
import { prisma } from "../db";
import * as taskService from "./taskService";
import { BadRequestError, NotFoundError } from "../http/errors";
import { logActivity } from "./activityService";

/** One time window in an evening plan (spec §3: "a schedule of time windows and tasks"). */
export const planItemSchema = z.object({
  title: z.string().trim().min(1),
  category: z.string().trim().optional(),
  notes: z.string().optional(),
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
});
export type PlanItem = z.infer<typeof planItemSchema>;

function checkItems(items: PlanItem[]) {
  if (!items.length) throw new BadRequestError("The plan has no items.");
  for (const item of items) {
    if (new Date(item.end) <= new Date(item.start)) {
      throw new BadRequestError(`"${item.title}" must end after it starts.`);
    }
  }
}

export async function proposePlan(conversationId: string | null, planDate: string, items: PlanItem[]) {
  const parsed = z.array(planItemSchema).parse(items);
  checkItems(parsed);
  if (conversationId) {
    await prisma.dayPlanProposal.updateMany({ where: { conversationId, status: "DRAFT" }, data: { status: "DISCARDED" } });
  }
  return prisma.dayPlanProposal.create({ data: { conversationId, planDate, itemsJson: JSON.stringify(parsed) } });
}

export async function getPlan(id: string) {
  const plan = await prisma.dayPlanProposal.findUnique({ where: { id } });
  if (!plan) throw new NotFoundError("That plan no longer exists.");
  return { ...plan, items: JSON.parse(plan.itemsJson) as PlanItem[] };
}

/**
 * Her "Save" on the edited plan: every item becomes a task (DRAFTED then
 * SCHEDULED, both logged), all in one transaction-safe pass. Saving twice is refused.
 */
export async function savePlan(id: string, editedItems?: PlanItem[]) {
  const plan = await getPlan(id);
  if (plan.status !== "DRAFT") throw new BadRequestError(`This plan was already ${plan.status === "SAVED" ? "saved" : "replaced or discarded"}.`);
  const items = editedItems ? z.array(planItemSchema).parse(editedItems) : plan.items;
  checkItems(items);

  const claim = await prisma.dayPlanProposal.updateMany({ where: { id, status: "DRAFT" }, data: { status: "SAVED", savedAt: new Date() } });
  if (claim.count === 0) throw new BadRequestError("This plan was already saved.");

  const tasks = [];
  try {
    for (const item of items) {
      tasks.push(
        await taskService.createTask({
          title: item.title,
          category: item.category,
          description: item.notes,
          timeWindowStart: new Date(item.start),
          timeWindowEnd: new Date(item.end),
          source: "VOICE",
        })
      );
    }
  } catch (err) {
    await prisma.dayPlanProposal.update({ where: { id }, data: { status: "DRAFT", savedAt: null } });
    throw err;
  }
  await prisma.dayPlanProposal.update({ where: { id }, data: { itemsJson: JSON.stringify(items) } });
  await logActivity("plan.saved", `Saved your plan for ${plan.planDate}: ${tasks.length} task(s).`, { type: "DayPlanProposal", id });
  return { plan: await getPlan(id), tasks };
}

export async function discardPlan(id: string) {
  await getPlan(id);
  await prisma.dayPlanProposal.update({ where: { id }, data: { status: "DISCARDED" } });
  return getPlan(id);
}
