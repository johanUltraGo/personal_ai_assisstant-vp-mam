import { Router } from "express";
import { recentActivity } from "../services/activityService";

export const activityRouter = Router();

activityRouter.get("/", async (req, res) => {
  const limit = Number(req.query.limit ?? 20);
  res.json(await recentActivity(Number.isFinite(limit) ? limit : 20));
});
