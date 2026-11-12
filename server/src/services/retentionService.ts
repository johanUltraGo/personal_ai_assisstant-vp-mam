import { prisma } from "../db";
import { logActivity } from "./activityService";

/**
 * Optional privacy setting (design §11 open question 2): conversations may
 * mention students, so CONVERSATION_RETENTION_DAYS deletes chats idle longer
 * than that many days. Empty or 0 keeps everything (the default until Uma and
 * Johan decide). Tasks, reminders and the sent-message record are not touched.
 */
export async function deleteOldConversations(now: Date = new Date()): Promise<number> {
  const days = Number(process.env.CONVERSATION_RETENTION_DAYS ?? "");
  if (!Number.isFinite(days) || days <= 0) return 0;
  const cutoff = new Date(now.getTime() - days * 864e5);
  const old = await prisma.conversation.findMany({ where: { updatedAt: { lt: cutoff } }, select: { id: true } });
  if (!old.length) return 0;
  const ids = old.map((c) => c.id);
  await prisma.conversationMessage.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
  await logActivity("privacy.chats_deleted", `Deleted ${ids.length} chat(s) older than ${days} days, as set in CONVERSATION_RETENTION_DAYS.`);
  return ids.length;
}
