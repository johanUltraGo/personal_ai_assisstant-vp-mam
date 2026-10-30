import { Router } from "express";
import { z } from "zod";
import { parseTaskFromText, MissingApiKeyError } from "../services/aiTaskParser";

export const aiRouter = Router();

const parseSchema = z.object({ text: z.string().min(1) });

/**
 * Parses free text (typed, or already transcribed from voice by the
 * client) into a task draft. This does not create the task — it only
 * returns a draft for her to review, consistent with the "ask rather
 * than guess" posture and the general human-in-the-loop requirement
 * that nothing gets scheduled without her seeing it first.
 */
aiRouter.post("/parse-task", async (req, res) => {
  const parsed = parseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const result = await parseTaskFromText(parsed.data.text);
    res.json(result);
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      return res.status(503).json({ error: err.message, blocked: "ANTHROPIC_API_KEY" });
    }
    res.status(502).json({ error: (err as Error).message });
  }
});
