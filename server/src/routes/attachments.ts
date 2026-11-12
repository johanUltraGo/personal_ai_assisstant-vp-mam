import { Router, raw } from "express";
import { z } from "zod";
import * as attachmentService from "../services/attachmentService";

export const attachmentsRouter = Router();

const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"]);

/**
 * Receives one selected photo or document as raw bytes (the page sends each
 * selected file in turn). Stored only against the task; never shared.
 */
attachmentsRouter.post("/", raw({ type: "*/*", limit: "10mb" }), async (req, res) => {
  const taskId = String(req.query.taskId ?? "");
  const originalName = decodeURIComponent(String(req.header("x-file-name") ?? "attachment"));
  if (!taskId) return res.status(400).json({ error: "taskId is required" });
  if (!Buffer.isBuffer(req.body)) return res.status(400).json({ error: "Upload bytes are required" });
  res.status(201).json(
    await attachmentService.saveTaskAttachment({ taskId, originalName, mimeType: req.header("content-type") ?? "application/octet-stream", content: req.body })
  );
});

attachmentsRouter.post("/drive-link", async (req, res) => {
  const { taskId, url, name } = z.object({ taskId: z.string().min(1), url: z.string().min(1), name: z.string().optional() }).parse(req.body);
  res.status(201).json(await attachmentService.attachDriveLink(taskId, url, name));
});

attachmentsRouter.get("/", async (req, res) => {
  const taskId = String(req.query.taskId ?? "");
  if (!taskId) return res.status(400).json({ error: "taskId is required" });
  res.json(await attachmentService.listTaskAttachments(taskId));
});

attachmentsRouter.get("/:id/file", async (req, res) => {
  const { attachment, stream } = await attachmentService.openAttachment(req.params.id);
  // Only photos and PDFs open in the browser; everything else (HTML, SVG, …)
  // downloads, and nothing served here may run script on the app's origin.
  const inline = INLINE_TYPES.has(attachment.mimeType.toLowerCase());
  res.setHeader("Content-Type", inline ? attachment.mimeType : "application/octet-stream");
  const asciiName = attachment.originalName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  res.setHeader(
    "Content-Disposition",
    `${inline ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`
  );
  res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
  res.setHeader("X-Content-Type-Options", "nosniff");
  stream.pipe(res);
});
