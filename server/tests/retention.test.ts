import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "../src/db";
import { deleteOldConversations } from "../src/services/retentionService";

describe("chat transcript retention", () => {
  afterEach(() => delete process.env.CONVERSATION_RETENTION_DAYS);

  async function conversationAged(days: number) {
    const c = await prisma.conversation.create({ data: { kind: "GENERAL" } });
    await prisma.conversationMessage.create({ data: { conversationId: c.id, role: "user", contentJson: JSON.stringify("Arun's leave") } });
    const at = new Date(Date.now() - days * 864e5);
    await prisma.conversation.update({ where: { id: c.id }, data: { updatedAt: at } });
    return c.id;
  }

  it("keeps everything when no retention is set", async () => {
    await conversationAged(400);
    expect(await deleteOldConversations()).toBe(0);
    expect(await prisma.conversation.count()).toBe(1);
  });

  it("deletes conversations (and their messages) idle longer than the setting", async () => {
    process.env.CONVERSATION_RETENTION_DAYS = "30";
    const old = await conversationAged(31);
    const recent = await conversationAged(5);
    expect(await deleteOldConversations()).toBe(1);
    expect(await prisma.conversation.findUnique({ where: { id: old } })).toBeNull();
    expect(await prisma.conversation.findUnique({ where: { id: recent } })).not.toBeNull();
    expect(await prisma.conversationMessage.count({ where: { conversationId: old } })).toBe(0);
  });
});
