import { Router } from "express";
import { z } from "zod";
import { CONVERSATION_KINDS, conversationTranscript, runTurn, startConversation } from "../assistant/agent";

export const assistantRouter = Router();

assistantRouter.post("/conversations", async (req, res) => {
  const { kind } = z.object({ kind: z.enum(CONVERSATION_KINDS as [string, ...string[]]).default("GENERAL") }).parse(req.body ?? {});
  res.status(201).json(await startConversation(kind as (typeof CONVERSATION_KINDS)[number]));
});

assistantRouter.get("/conversations/:id", async (req, res) => {
  res.json(await conversationTranscript(req.params.id));
});

const turnSchema = z.object({ text: z.string().trim().min(1).max(4000), inputMode: z.enum(["VOICE", "TYPED"]).default("TYPED") });

/** One thing she said or typed; returns the reply and any cards (Send?, plan, changes). */
assistantRouter.post("/conversations/:id/messages", async (req, res) => {
  const { text, inputMode } = turnSchema.parse(req.body);
  res.json(await runTurn(req.params.id, text, inputMode));
});
