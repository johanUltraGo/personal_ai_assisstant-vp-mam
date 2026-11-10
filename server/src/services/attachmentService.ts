import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { prisma } from "../db";

const uploadRoot = path.resolve(process.env.ATTACHMENT_STORAGE_PATH || path.join(process.cwd(), "uploads"));
const maxUploadBytes = 10 * 1024 * 1024;

export async function saveTaskAttachment(input: {
  taskId: string;
  originalName: string;
  mimeType: string;
  content: Buffer;
}) {
  if (!input.content.length) throw new Error("The attachment is empty.");
  if (input.content.length > maxUploadBytes) throw new Error("Attachments must be 10 MB or smaller.");
  await prisma.task.findUniqueOrThrow({ where: { id: input.taskId } });

  const safeName = path.basename(input.originalName).replace(/[^a-zA-Z0-9._-]/g, "_") || "attachment";
  const storedName = `${randomUUID()}-${safeName}`;
  await fs.mkdir(uploadRoot, { recursive: true });
  await fs.writeFile(path.join(uploadRoot, storedName), input.content, { flag: "wx" });
  try {
    return await prisma.attachment.create({
      data: { taskId: input.taskId, originalName: safeName, storedName, mimeType: input.mimeType || "application/octet-stream", size: input.content.length },
    });
  } catch (error) {
    await fs.unlink(path.join(uploadRoot, storedName)).catch(() => {});
    throw error;
  }
}

export function listTaskAttachments(taskId: string) {
  return prisma.attachment.findMany({ where: { taskId }, orderBy: { createdAt: "asc" } });
}
