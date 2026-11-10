import { Router } from "express";
import { z } from "zod";
import { draftLeaveLetter } from "../services/leaveLetterService";

export const leaveRouter = Router();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const draftSchema = z.object({
  audience: z.enum(["TEACHER", "STUDENT"]),
  names: z.array(z.string().min(1)).min(1),
  fromDate: isoDate,
  toDate: isoDate.optional(),
  reason: z.string().optional(),
  schoolName: z.string().optional(),
});

/** Draft only; the screen prepares it as a "Send?" preview if she wants to send it. */
leaveRouter.post("/draft", async (req, res) => {
  res.json(await draftLeaveLetter(draftSchema.parse(req.body)));
});
