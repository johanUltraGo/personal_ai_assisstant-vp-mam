import Anthropic from "@anthropic-ai/sdk";
import { DateTime } from "luxon";
import { prisma } from "../db";
import { callClaude, ClaudeLike, Effort, getClaude } from "../ai/claude";
import Anthropic2 from "@anthropic-ai/sdk";
import { NotFoundError } from "../http/errors";
import { ConversationBusyError, ConversationBrokenError } from "./errors";
import { schoolTimezone, startOfDay, tasksForDay } from "../services/morningListService";
import { SYSTEM_PROMPT } from "./prompt";
import { Card, runTool, toolDefinitions } from "./tools";
import "./registerFeatureTools";

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type ContentBlock = Anthropic.Beta.Messages.BetaContentBlock;

export type ConversationKind = "GENERAL" | "EVENING_PLAN" | "MORNING_REPLY";
export const CONVERSATION_KINDS: ConversationKind[] = ["GENERAL", "EVENING_PLAN", "MORNING_REPLY"];

const MAX_MODEL_CALLS = 8;

export { ConversationBusyError, ConversationBrokenError };

const runningTurns = new Set<string>();
const EFFORT: Record<ConversationKind, Effort> = { GENERAL: "low", MORNING_REPLY: "low", EVENING_PLAN: "medium" };

export function startConversation(kind: ConversationKind) {
  return prisma.conversation.create({ data: { kind } });
}

async function appendMessage(conversationId: string, role: "user" | "assistant", content: unknown) {
  await prisma.conversationMessage.create({ data: { conversationId, role, contentJson: JSON.stringify(content) } });
}

/**
 * Stored history, replayed unchanged. If a tool call never got its result
 * (process stopped mid-turn), an error result is supplied for it so the
 * conversation can continue instead of failing on every later turn.
 */
async function history(conversationId: string): Promise<MessageParam[]> {
  const rows = await prisma.conversationMessage.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" } });
  const messages: MessageParam[] = [];
  rows.forEach((row, i) => {
    const content = JSON.parse(row.contentJson);
    messages.push({ role: row.role as "user" | "assistant", content });
    if (row.role !== "assistant" || !Array.isArray(content)) return;
    const pendingIds = content.filter((b: any) => b.type === "tool_use").map((b: any) => b.id as string);
    if (!pendingIds.length) return;
    const next = rows[i + 1] ? JSON.parse(rows[i + 1].contentJson) : null;
    const answered = new Set(Array.isArray(next) ? next.filter((b: any) => b.type === "tool_result").map((b: any) => b.tool_use_id) : []);
    const missing = pendingIds.filter((id) => !answered.has(id));
    if (missing.length) {
      messages.push({
        role: "user",
        content: missing.map((id) => ({ type: "tool_result" as const, tool_use_id: id, content: "This step was interrupted and did not run.", is_error: true })),
      });
    }
  });
  return messages;
}

/** Fresh facts for this turn, kept out of the cached system prompt. */
async function contextBlock(kind: ConversationKind): Promise<string> {
  const now = DateTime.now().setZone(schoolTimezone());
  const today = startOfDay().toISODate()!;
  const tasks = await tasksForDay(today);
  const confirmed = await prisma.dayPlanConfirmation.findUnique({ where: { date: today } });
  const lines = tasks.map(
    (t) =>
      `- [${t.id}] ${DateTime.fromJSDate(t.timeWindowStart, { zone: schoolTimezone() }).toFormat("h:mm a")}–${DateTime.fromJSDate(t.timeWindowEnd, { zone: schoolTimezone() }).toFormat("h:mm a")} ${t.title} (${t.status})`
  );
  return [
    "<context>",
    `Now: ${now.toISO()} (${now.toFormat("cccc d LLLL yyyy, h:mm a")}, timezone ${schoolTimezone()})`,
    `Mode: ${kind}`,
    `Today's list (${today})${confirmed ? ", confirmed by her" : ""}:`,
    ...(lines.length ? lines : ["- nothing scheduled"]),
    "</context>",
  ].join("\n");
}

export interface TurnResult {
  reply: string;
  cards: Card[];
}

/**
 * One turn with the assistant (design §3.1): her words go in with fresh
 * context, Claude may call tools (validated, at most 8 rounds), and the reply
 * text plus screen cards come back. Every message is stored exactly as sent
 * or received and only appended, so later turns replay it unchanged.
 */
export async function runTurn(
  conversationId: string,
  text: string,
  inputMode: "VOICE" | "TYPED",
  client?: ClaudeLike
): Promise<TurnResult> {
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation) throw new NotFoundError("That conversation no longer exists.");
  if (runningTurns.has(conversationId)) throw new ConversationBusyError();
  runningTurns.add(conversationId);
  try {
    return await runTurnLocked(conversationId, conversation.kind as ConversationKind, text, inputMode, client ?? getClaude());
  } catch (err) {
    // 400/413 from Claude here means the stored history itself is unusable.
    if (err instanceof Anthropic2.APIError && (err.status === 400 || err.status === 413)) {
      // eslint-disable-next-line no-console
      console.error("[assistant] conversation rejected:", err.status, err.message);
      throw new ConversationBrokenError();
    }
    throw err;
  } finally {
    runningTurns.delete(conversationId);
  }
}

async function runTurnLocked(
  conversationId: string,
  kind: ConversationKind,
  text: string,
  inputMode: "VOICE" | "TYPED",
  client: ClaudeLike
): Promise<TurnResult> {

  const messages = await history(conversationId);
  const userMessage: MessageParam = { role: "user", content: `${await contextBlock(kind)}\n\n${text}` };
  messages.push(userMessage);
  await appendMessage(conversationId, "user", userMessage.content);

  const cards: Card[] = [];
  const flags = new Set<string>();
  for (let call = 0; call < MAX_MODEL_CALLS; call++) {
    const response = await callClaude(client, { system: SYSTEM_PROMPT, tools: toolDefinitions(), messages, effort: EFFORT[kind] });

    // A refusal or a cut-off reply can end mid tool call: run nothing from it.
    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
      const reply =
        response.stop_reason === "refusal"
          ? "Sorry, I can't help with that one."
          : "That needed a longer answer than I can give at once. Could you ask for a smaller part?";
      await appendMessage(conversationId, "assistant", [{ type: "text", text: reply }]);
      return { reply, cards };
    }

    const content = response.content as ContentBlock[];
    messages.push({ role: "assistant", content });
    await appendMessage(conversationId, "assistant", content);

    const toolUses = content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      const reply = content
        .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { reply: reply || "Done.", cards };
    }

    const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const outcome = await runTool(use.name, use.input, { conversationId, inputMode, cards, flags });
      results.push({ type: "tool_result", tool_use_id: use.id, content: outcome.content, ...(outcome.isError ? { is_error: true } : {}) });
    }
    const toolMessage: MessageParam = { role: "user", content: results };
    messages.push(toolMessage);
    await appendMessage(conversationId, "user", results);
  }

  const reply = "I couldn't finish that in one go. Please try again, perhaps one step at a time.";
  await appendMessage(conversationId, "assistant", [{ type: "text", text: reply }]);
  return { reply, cards };
}

/** What the screen shows of a conversation: her words (without the context block) and the assistant's text. */
export async function conversationTranscript(conversationId: string) {
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation) throw new NotFoundError("That conversation no longer exists.");
  const rows = await prisma.conversationMessage.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" } });
  const lines: { role: "user" | "assistant"; text: string }[] = [];
  for (const row of rows) {
    const content = JSON.parse(row.contentJson);
    if (typeof content === "string") {
      lines.push({ role: "user", text: content.replace(/^<context>[\s\S]*?<\/context>\s*/, "") });
    } else if (row.role === "assistant") {
      const text = (content as any[]).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      if (text) lines.push({ role: "assistant", text });
    }
  }
  return { id: conversation.id, kind: conversation.kind, messages: lines };
}
