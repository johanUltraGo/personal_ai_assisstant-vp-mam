import { Router } from "express";
import { z } from "zod";
import { discardPlan, getPlan, planItemSchema, savePlan } from "../services/planService";

export const plansRouter = Router();

plansRouter.get("/:id", async (req, res) => {
  res.json(await getPlan(req.params.id));
});

/** Saves the plan as she edited it on screen (items optional = save as proposed). */
plansRouter.post("/:id/save", async (req, res) => {
  const { items } = z.object({ items: z.array(planItemSchema).optional() }).parse(req.body ?? {});
  res.json(await savePlan(req.params.id, items));
});

plansRouter.post("/:id/discard", async (req, res) => {
  res.json(await discardPlan(req.params.id));
});
