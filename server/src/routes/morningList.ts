import { Router } from "express";
import { buildMorningList } from "../services/morningListService";

export const morningListRouter = Router();

/**
 * Fetches (and, as a side effect, regenerates — including running
 * carry-forward) today's morning list on demand. The 9:00 AM cron job
 * calls the same underlying service automatically; this endpoint exists
 * so the list is also available any time she opens the app, and so
 * tests can exercise the logic without waiting for the clock.
 */
morningListRouter.get("/today", async (_req, res) => {
  const list = await buildMorningList();
  res.json(list);
});
