import { Router } from "express";
import { z } from "zod";
import { draftLeaveLetter } from "../services/leaveLetterService";

export const leaveRouter = Router();

const draftSchema = z.object({
  audience: z.enum(["TEACHER", "STUDENT"]),
  names: z.array(z.string().min(1)).min(1),
  leaveDate: z.coerce.date(),
  reason: z.string().optional(),
  schoolName: z.string().optional(),
});

/** Draft only. The browser must show this unchanged and call /api/messaging/prepare then /confirm-send if she says Send. */
leaveRouter.post("/draft", (req, res) => {
  const parsed = draftSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.json(draftLeaveLetter(parsed.data));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
