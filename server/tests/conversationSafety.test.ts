import { describe, it, expect } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import request from "supertest";
import { prisma } from "../src/db";
import { createApp } from "../src/app";
import { runTurn, startConversation, ConversationBusyError, ConversationBrokenError } from "../src/assistant/agent";
import { ClaudeLike } from "../src/ai/claude";

const text = (t: string) => ({ type: "text", text: t });

describe("conversation safety", () => {
  it("refuses a second message while the first is still being answered", async () => {
    const convo = await startConversation("GENERAL");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: ClaudeLike = {
      beta: { messages: { create: async () => { await gate; return { content: [text("done")], stop_reason: "end_turn" } as any; } } },
    };
    const first = runTurn(convo.id, "first", "TYPED", slow);
    await new Promise((r) => setTimeout(r, 50));
    await expect(runTurn(convo.id, "second", "TYPED", slow)).rejects.toBeInstanceOf(ConversationBusyError);
    release();
    expect((await first).reply).toBe("done");
    // and the conversation is free again afterwards
    const after = await runTurn(convo.id, "third", "TYPED", { beta: { messages: { create: async () => ({ content: [text("ok")], stop_reason: "end_turn" }) as any } } });
    expect(after.reply).toBe("ok");
  });

  it("repairs a stored tool call that never got its result", async () => {
    const convo = await startConversation("GENERAL");
    await prisma.conversationMessage.create({ data: { conversationId: convo.id, role: "user", contentJson: JSON.stringify("hi") } });
    await prisma.conversationMessage.create({
      data: { conversationId: convo.id, role: "assistant", contentJson: JSON.stringify([{ type: "tool_use", id: "t9", name: "list_reminders", input: {} }]) },
    });
    const requests: any[] = [];
    const client: ClaudeLike = { beta: { messages: { create: async (p: any) => { requests.push(p); return { content: [text("ok")], stop_reason: "end_turn" } as any; } } } };
    await runTurn(convo.id, "hello again", "TYPED", client);
    const sent = requests[0].messages;
    expect(sent[2].role).toBe("user");
    expect(sent[2].content[0]).toMatchObject({ type: "tool_result", tool_use_id: "t9", is_error: true });
  });

  it("tells her to start a new conversation when the API rejects its history", async () => {
    const convo = await startConversation("GENERAL");
    const rejecting: ClaudeLike = {
      beta: { messages: { create: async () => { throw new Anthropic.BadRequestError(400, { type: "error" }, "invalid content", new Headers()); } } },
    };
    await expect(runTurn(convo.id, "hi", "TYPED", rejecting)).rejects.toBeInstanceOf(ConversationBrokenError);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: convo.id } })).kind).toBe("GENERAL");
  });

  it("answers 409 over HTTP for a busy or broken conversation", async () => {
    const res = await request(createApp()).post("/api/assistant/conversations/nope/messages").send({ text: "hi" });
    expect(res.status).toBe(404);
  });
});
