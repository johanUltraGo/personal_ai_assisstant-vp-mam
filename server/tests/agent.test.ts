import { describe, it, expect } from "vitest";
import request from "supertest";
import { prisma } from "../src/db";
import { createApp } from "../src/app";
import { runTurn, startConversation } from "../src/assistant/agent";
import { ClaudeLike } from "../src/ai/claude";
import * as contactService from "../src/services/contactService";
import * as taskService from "../src/services/taskService";

type Reply = { content: any[]; stop_reason: string };

/** Plays back scripted replies and records every request it received. */
function scripted(replies: Reply[]) {
  const requests: any[] = [];
  const client: ClaudeLike = {
    beta: {
      messages: {
        create: async (params: any) => {
          requests.push(JSON.parse(JSON.stringify(params)));
          const next = replies.shift();
          if (!next) throw new Error("no scripted reply left");
          return { id: "msg", role: "assistant", ...next } as any;
        },
      },
    },
  };
  return { client, requests };
}

const toolUse = (id: string, name: string, input: object) => ({ type: "tool_use", id, name, input });
const text = (t: string) => ({ type: "text", text: t });
const inOneHour = () => new Date(Date.now() + 3600_000).toISOString();

describe("assistant agent loop", () => {
  it("sets a reminder she asked for and replies", async () => {
    const convo = await startConversation("GENERAL");
    const { client, requests } = scripted([
      { content: [toolUse("t1", "set_reminder", { label: "Call Mrs Iyer", fireAt: inOneHour() })], stop_reason: "tool_use" },
      { content: [text("Done — I'll remind you in an hour.")], stop_reason: "end_turn" },
    ]);
    const result = await runTurn(convo.id, "remind me in an hour to call Mrs Iyer", "VOICE", client);
    expect(result.reply).toContain("remind you");
    expect(await prisma.reminder.count()).toBe(1);
    const toolResult = requests[1].messages.at(-1).content[0];
    expect(toolResult).toMatchObject({ type: "tool_result", tool_use_id: "t1" });
    expect(toolResult.is_error).toBeFalsy();
    expect(requests[0].messages[0].content).toContain("<context>");
    expect(result.cards.some((c) => c.type === "changed")).toBe(true);
  });

  it("prepares a message as a Send? card and never sends it", async () => {
    const contact = await contactService.createContact({ displayName: "Mr. Raman", email: "raman@example.com" });
    const convo = await startConversation("GENERAL");
    const { client } = scripted([
      { content: [toolUse("t1", "prepare_message", { contactId: contact.id, channel: "EMAIL", subject: "Meeting", body: "See you at 3." })], stop_reason: "tool_use" },
      { content: [text("It's ready — tap Send if it looks right.")], stop_reason: "end_turn" },
    ]);
    const result = await runTurn(convo.id, "email Raman that I'll see him at 3", "TYPED", client);
    const card = result.cards.find((c) => c.type === "send");
    expect(card).toBeTruthy();
    expect(await prisma.messageSent.count()).toBe(0);
    expect(await prisma.pendingMessage.count()).toBe(1);
  });

  it("returns an error result for bad tool input and runs nothing", async () => {
    const convo = await startConversation("GENERAL");
    const { client, requests } = scripted([
      { content: [toolUse("t1", "set_reminder", { label: "", fireAt: "tomorrow-ish" })], stop_reason: "tool_use" },
      { content: [text("When should I remind you?")], stop_reason: "end_turn" },
    ]);
    await runTurn(convo.id, "remind me", "TYPED", client);
    expect(await prisma.reminder.count()).toBe(0);
    expect(requests[1].messages.at(-1).content[0].is_error).toBe(true);
  });

  it("runs no tools when Claude declines", async () => {
    const convo = await startConversation("GENERAL");
    const { client } = scripted([
      { content: [toolUse("t1", "set_reminder", { label: "x", fireAt: inOneHour() })], stop_reason: "refusal" },
    ]);
    const result = await runTurn(convo.id, "something", "TYPED", client);
    expect(result.reply).toMatch(/can't help/i);
    expect(await prisma.reminder.count()).toBe(0);
  });

  it("replays earlier turns unchanged on the next turn", async () => {
    const convo = await startConversation("GENERAL");
    const first = scripted([{ content: [{ type: "thinking", thinking: "", signature: "sig" }, text("Hello!")], stop_reason: "end_turn" }]);
    await runTurn(convo.id, "hi", "TYPED", first.client);
    const second = scripted([{ content: [text("Sure.")], stop_reason: "end_turn" }]);
    await runTurn(convo.id, "thanks", "TYPED", second.client);
    const sent = second.requests[0].messages;
    expect(sent[0]).toEqual(first.requests[0].messages[0]);
    expect(sent[1]).toEqual({ role: "assistant", content: [{ type: "thinking", thinking: "", signature: "sig" }, text("Hello!")] });
    expect(sent).toHaveLength(3);
  });

  it("completes a task only through her instruction and logs her as the actor", async () => {
    const task = await taskService.createTask({ title: "Assembly", timeWindowStart: new Date(), timeWindowEnd: new Date(Date.now() + 3600_000) });
    const convo = await startConversation("GENERAL");
    const { client } = scripted([
      { content: [toolUse("t1", "complete_task", { taskId: task.id })], stop_reason: "tool_use" },
      { content: [text("Marked done.")], stop_reason: "end_turn" },
    ]);
    await runTurn(convo.id, "assembly is done, mark it", "VOICE", client);
    const full = await taskService.getTask(task.id);
    expect(full.status).toBe("COMPLETED");
    expect(full.history.at(-1)?.changedBy).toBe("principal");
  });

  it("answers 503 over HTTP when no API key is configured", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const app = createApp();
    const convo = await request(app).post("/api/assistant/conversations").send({ kind: "GENERAL" });
    expect(convo.status).toBe(201);
    const res = await request(app).post(`/api/assistant/conversations/${convo.body.id}/messages`).send({ text: "hi" });
    expect(res.status).toBe(503);
    if (saved) process.env.ANTHROPIC_API_KEY = saved;
  });
});
