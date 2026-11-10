import Anthropic from "@anthropic-ai/sdk";
import { DateTime } from "luxon";
import { z, ZodTypeAny } from "zod";
import { PendingMessage } from "@prisma/client";
import { prisma } from "../db";
import * as taskService from "../services/taskService";
import * as reminderService from "../services/reminderService";
import * as contactService from "../services/contactService";
import * as messagingService from "../services/messagingService";
import { confirmDay, schoolTimezone, startOfDay, tasksForDay } from "../services/morningListService";
import { recentActivity } from "../services/activityService";

/** Things the screen shows next to the assistant's reply. */
export type Card =
  | { type: "send"; pending: PendingMessage }
  | { type: "plan"; proposalId: string }
  | { type: "changed"; summary: string };

export interface ToolContext {
  conversationId: string;
  inputMode: "VOICE" | "TYPED";
  cards: Card[];
}

type ToolContent = string | Anthropic.Beta.Messages.BetaToolResultBlockParam["content"];

export interface AssistantTool<S extends ZodTypeAny = ZodTypeAny> {
  name: string;
  description: string;
  input_schema: Anthropic.Beta.Messages.BetaTool["input_schema"];
  schema: S;
  run(input: z.infer<S>, ctx: ToolContext): Promise<ToolContent | object>;
}

export function defineTool<S extends ZodTypeAny>(tool: AssistantTool<S>): AssistantTool<S> {
  return tool;
}

// --- small schema helpers -------------------------------------------------
const isoDateTime = z.string().datetime({ offset: true }).transform((s) => new Date(s));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const obj = (properties: Record<string, object>, required: string[] = []) => ({
  type: "object" as const,
  properties,
  required,
  additionalProperties: false,
});
const str = (description: string) => ({ type: "string", description });
const DATETIME_HINT = "ISO 8601 with offset, e.g. 2026-11-11T10:00:00+05:30";

function taskView(t: { id: string; title: string; category: string | null; timeWindowStart: Date; timeWindowEnd: Date; status: string; carriedOverCount: number }) {
  const zone = schoolTimezone();
  return {
    id: t.id,
    title: t.title,
    category: t.category,
    start: DateTime.fromJSDate(t.timeWindowStart, { zone }).toISO(),
    end: DateTime.fromJSDate(t.timeWindowEnd, { zone }).toISO(),
    status: t.status,
    carriedOverDays: t.carriedOverCount,
  };
}

function when(d: Date) {
  return DateTime.fromJSDate(d, { zone: schoolTimezone() }).toFormat("ccc d LLL, h:mm a");
}

// --- tools ---------------------------------------------------------------
const tools: AssistantTool[] = [
  defineTool({
    name: "get_day_plan",
    description: "List her tasks for one day (default today) with status and time windows, and whether she confirmed that day's list.",
    input_schema: obj({ date: str("YYYY-MM-DD; omit for today") }),
    schema: z.object({ date: isoDate.optional() }),
    async run({ date }) {
      const day = date ?? startOfDay().toISODate()!;
      const [tasks, confirmation] = await Promise.all([
        tasksForDay(day),
        prisma.dayPlanConfirmation.findUnique({ where: { date: day } }),
      ]);
      return { date: day, confirmed: !!confirmation, tasks: tasks.map(taskView) };
    },
  }),
  defineTool({
    name: "create_task",
    description: "Add one task she asked for, with a concrete time window. It is scheduled immediately; tell her the window you used.",
    input_schema: obj(
      { title: str("Short title in her words"), category: str("e.g. admin, teaching, exams, events"), description: str("Extra detail"), start: str(DATETIME_HINT), end: str(DATETIME_HINT) },
      ["title", "start", "end"]
    ),
    schema: z.object({ title: z.string().trim().min(1), category: z.string().optional(), description: z.string().optional(), start: isoDateTime, end: isoDateTime }),
    async run(input, ctx) {
      const task = await taskService.createTask({
        title: input.title,
        category: input.category,
        description: input.description,
        timeWindowStart: input.start,
        timeWindowEnd: input.end,
        source: ctx.inputMode,
      });
      ctx.cards.push({ type: "changed", summary: `Added "${task.title}" — ${when(task.timeWindowStart)}` });
      return taskView(task);
    },
  }),
  defineTool({
    name: "update_task",
    description: "Rename or move an existing task to a new time window (including another day).",
    input_schema: obj({ taskId: str("Task id from get_day_plan"), title: str("New title"), start: str(DATETIME_HINT), end: str(DATETIME_HINT) }, ["taskId"]),
    schema: z.object({ taskId: z.string().min(1), title: z.string().trim().min(1).optional(), start: isoDateTime.optional(), end: isoDateTime.optional() }),
    async run(input, ctx) {
      const task = await taskService.updateTask(input.taskId, { title: input.title, timeWindowStart: input.start, timeWindowEnd: input.end });
      ctx.cards.push({ type: "changed", summary: `Moved "${task.title}" — ${when(task.timeWindowStart)}` });
      return taskView(task);
    },
  }),
  defineTool({
    name: "cancel_task",
    description: "Cancel a task she says is no longer needed. Its history is kept.",
    input_schema: obj({ taskId: str("Task id"), reason: str("Her reason, if she gave one") }, ["taskId"]),
    schema: z.object({ taskId: z.string().min(1), reason: z.string().optional() }),
    async run(input, ctx) {
      const task = await taskService.cancelTask(input.taskId, input.reason);
      ctx.cards.push({ type: "changed", summary: `Cancelled "${task.title}"` });
      return taskView(task);
    },
  }),
  defineTool({
    name: "start_task",
    description: "Mark a task as in progress when she says she has started it.",
    input_schema: obj({ taskId: str("Task id") }, ["taskId"]),
    schema: z.object({ taskId: z.string().min(1) }),
    async run({ taskId }) {
      return taskView(await taskService.startTask(taskId));
    },
  }),
  defineTool({
    name: "complete_task",
    description: "Mark a task completed. ONLY when she explicitly says it is done or asks you to mark it done — never infer it.",
    input_schema: obj({ taskId: str("Task id") }, ["taskId"]),
    schema: z.object({ taskId: z.string().min(1) }),
    async run({ taskId }, ctx) {
      const task = await taskService.completeTask(taskId, "She told the assistant it is done");
      ctx.cards.push({ type: "changed", summary: `Completed "${task.title}"` });
      return taskView(task);
    },
  }),
  defineTool({
    name: "confirm_day_plan",
    description: "Record that she confirmed a day's work list (default today).",
    input_schema: obj({ date: str("YYYY-MM-DD; omit for today") }),
    schema: z.object({ date: isoDate.optional() }),
    async run({ date }, ctx) {
      const day = date ?? startOfDay().toISODate()!;
      await confirmDay(day, "ASSISTANT");
      ctx.cards.push({ type: "changed", summary: `Confirmed the list for ${day}` });
      return { confirmed: day };
    },
  }),
  defineTool({
    name: "set_reminder",
    description: "Create a reminder she asked for, at the time she gave (up to any date). Optional repeat only if she asked for it.",
    input_schema: obj(
      { label: str("What to remind her about"), fireAt: str(DATETIME_HINT), taskId: str("Related task id, if any"), repeat: { type: "string", enum: ["DAILY", "WEEKLY"] } },
      ["label", "fireAt"]
    ),
    schema: z.object({ label: z.string().trim().min(1), fireAt: isoDateTime, taskId: z.string().optional(), repeat: z.enum(["DAILY", "WEEKLY"]).optional() }),
    async run(input, ctx) {
      if (input.fireAt.getTime() < Date.now() - 60_000) throw new Error("That time has already passed. Ask her for a future time.");
      const reminder = await reminderService.createReminder({ label: input.label, fireAt: input.fireAt, taskId: input.taskId, repeatRule: input.repeat });
      ctx.cards.push({ type: "changed", summary: `Reminder "${reminder.label}" — ${when(reminder.fireAt)}` });
      return { id: reminder.id, label: reminder.label, fireAt: DateTime.fromJSDate(reminder.fireAt, { zone: schoolTimezone() }).toISO(), repeat: reminder.repeatRule };
    },
  }),
  defineTool({
    name: "list_reminders",
    description: "Her upcoming reminders and any that failed to reach her.",
    input_schema: obj({}),
    schema: z.object({}),
    async run() {
      const reminders = await prisma.reminder.findMany({
        where: { OR: [{ status: "PENDING" }, { status: "FAILED" }] },
        orderBy: { fireAt: "asc" },
        take: 50,
      });
      return reminders.map((r) => ({ id: r.id, label: r.label, fireAt: DateTime.fromJSDate(r.fireAt, { zone: schoolTimezone() }).toISO(), status: r.status, repeat: r.repeatRule }));
    },
  }),
  defineTool({
    name: "reschedule_reminder",
    description: "Move one of her reminders to a new time.",
    input_schema: obj({ reminderId: str("Reminder id"), fireAt: str(DATETIME_HINT) }, ["reminderId", "fireAt"]),
    schema: z.object({ reminderId: z.string().min(1), fireAt: isoDateTime }),
    async run(input, ctx) {
      const r = await reminderService.reschedule(input.reminderId, input.fireAt);
      ctx.cards.push({ type: "changed", summary: `Reminder "${r.label}" moved to ${when(r.fireAt)}` });
      return { id: r.id, fireAt: r.fireAt.toISOString() };
    },
  }),
  defineTool({
    name: "find_contacts",
    description: "Look up people or groups (parents' group, teachers' group) by name, with which channels they have.",
    input_schema: obj({ name: str("Name or part of it") }, ["name"]),
    schema: z.object({ name: z.string().trim().min(1) }),
    async run({ name }) {
      const matches = await contactService.findContactsByName(name);
      return matches.map((c) => ({ id: c.id, name: c.displayName, kind: c.kind, hasEmail: !!c.email, hasWhatsApp: c.kind === "GROUP" || !!c.whatsappNumber }));
    },
  }),
  defineTool({
    name: "prepare_message",
    description:
      "Prepare an email or WhatsApp message she asked for. This does NOT send: her screen shows the exact message with one Send? button. Afterwards tell her it is ready to send.",
    input_schema: obj(
      { contactId: str("Id from find_contacts"), channel: { type: "string", enum: ["EMAIL", "WHATSAPP"] }, subject: str("Email subject"), body: str("Full message text"), calendarEventId: str("School calendar event this notice is about, if any") },
      ["contactId", "channel", "body"]
    ),
    schema: z.object({ contactId: z.string().min(1), channel: z.enum(["EMAIL", "WHATSAPP"]), subject: z.string().optional(), body: z.string().trim().min(1), calendarEventId: z.string().optional() }),
    async run(input, ctx) {
      const pending = await messagingService.prepareMessage(input);
      ctx.cards.push({ type: "send", pending });
      return { pendingMessageId: pending.id, to: pending.recipientName, channel: pending.channel, status: "Shown to her with a Send? button. Not sent." };
    },
  }),
  defineTool({
    name: "get_recent_activity",
    description: "What the assistant and its scheduled jobs did recently (reminders sent, lists prepared, messages sent). Use it to answer 'what are you doing / what did you do'.",
    input_schema: obj({ limit: { type: "integer", description: "How many entries, default 15" } }),
    schema: z.object({ limit: z.number().int().min(1).max(50).optional() }),
    async run({ limit }) {
      const entries = await recentActivity(limit ?? 15);
      return entries.map((e) => ({ at: DateTime.fromJSDate(e.at, { zone: schoolTimezone() }).toFormat("ccc d LLL h:mm a"), what: e.summary }));
    },
  }),
];

/** Later features register their tools here (planning, Drive, leave, calendar). */
export function registerTool(tool: AssistantTool) {
  if (tools.some((t) => t.name === tool.name)) return;
  tools.push(tool);
}

export function toolDefinitions(): Anthropic.Beta.Messages.BetaTool[] {
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
}

/** Validates the input, runs the tool, and turns any failure into an error result Claude can act on. */
export async function runTool(name: string, input: unknown, ctx: ToolContext): Promise<{ content: ToolContent; isError: boolean }> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { content: `Unknown tool ${name}.`, isError: true };
  const parsed = tool.schema.safeParse(input);
  if (!parsed.success) {
    return { content: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}`, isError: true };
  }
  try {
    const result = await tool.run(parsed.data, ctx);
    if (typeof result === "string" || Array.isArray(result)) {
      return { content: Array.isArray(result) && result.every((b: any) => typeof b === "object" && b?.type) ? (result as ToolContent) : JSON.stringify(result), isError: false };
    }
    return { content: JSON.stringify(result), isError: false };
  } catch (err) {
    const message = (err as Error).message || "That did not work.";
    return { content: message.includes("No record") || (err as any).code === "P2025" ? "Not found — check the id with get_day_plan or list_reminders." : message, isError: true };
  }
}
