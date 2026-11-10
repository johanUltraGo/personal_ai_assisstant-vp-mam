import { Router, raw } from "express";
import * as attachmentService from "../services/attachmentService";

export const attachmentsRouter = Router();

/**
 * Receives a single selected photo or document as raw bytes. It stores it only
 * against the supplied task; this endpoint never invokes a connector or sends
 * the file to another person.
 */
attachmentsRouter.post("/", raw({ type: "*/*", limit: "10mb" }), async (req, res) => {
  const taskId = String(req.query.taskId ?? "");
  const originalName = String(req.header("x-file-name") ?? "attachment");
  if (!taskId) return res.status(400).json({ error: "taskId is required" });
  if (!Buffer.isBuffer(req.body)) return res.status(400).json({ error: "Upload bytes are required" });
  try {
    res.status(201).json(await attachmentService.saveTaskAttachment({
      taskId, originalName, mimeType: req.header("content-type") ?? "application/octet-stream", content: req.body,
    }));
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

attachmentsRouter.get("/", async (req, res) => {
  const taskId = String(req.query.taskId ?? "");
  if (!taskId) return res.status(400).json({ error: "taskId is required" });
  res.json(await attachmentService.listTaskAttachments(taskId));
});
