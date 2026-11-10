import { randomUUID } from "crypto";
import { promises as fs, createReadStream } from "fs";
import path from "path";
import { prisma } from "../db";
import { BadRequestError, NotFoundError } from "../http/errors";
import { driveFileIdFrom } from "../connectors/driveConnector";

const uploadRoot = path.resolve(process.env.ATTACHMENT_STORAGE_PATH || path.join(process.cwd(), "uploads"));
const maxUploadBytes = 10 * 1024 * 1024;

/** Spec §4: photos and documents go to the chosen task straight away. */
export async function saveTaskAttachment(input: { taskId: string; originalName: string; mimeType: string; content: Buffer }) {
  if (!input.content.length) throw new BadRequestError("The attachment is empty.");
  if (input.content.length > maxUploadBytes) throw new BadRequestError("Attachments must be 10 MB or smaller.");
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

/** Spec §4: attach a document from Google Drive — stored as a link, not copied. */
export async function attachDriveLink(taskId: string, url: string, name?: string) {
  await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
  const driveFileId = driveFileIdFrom(url);
  return prisma.attachment.create({
    data: { taskId, originalName: name?.trim() || `Drive file ${driveFileId}`, driveFileId, mimeType: "application/vnd.google-apps.link", size: 0 },
  });
}

export function listTaskAttachments(taskId: string) {
  return prisma.attachment.findMany({ where: { taskId }, orderBy: { createdAt: "asc" } });
}

/** Opens a stored file for download. Names come from the database, never from the request. */
export async function openAttachment(id: string) {
  const attachment = await prisma.attachment.findUnique({ where: { id } });
  if (!attachment || !attachment.storedName) throw new NotFoundError("That attachment has no stored file.");
  const filePath = path.join(uploadRoot, attachment.storedName);
  await fs.access(filePath).catch(() => {
    throw new NotFoundError("The attached file is missing from storage.");
  });
  return { attachment, stream: createReadStream(filePath) };
}
