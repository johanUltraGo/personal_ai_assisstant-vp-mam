import { Router } from "express";
import { z } from "zod";
import * as taskService from "../services/taskService";
import { TASK_SOURCES } from "../domain/types";

export const tasksRouter = Router();

const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  timeWindowStart: z.coerce.date(),
  timeWindowEnd: z.coerce.date(),
  source: z.enum(TASK_SOURCES).optional(),
});

tasksRouter.post("/", async (req, res) => {
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  try {
    const task = await taskService.createTask(parsed.data);
    res.status(201).json(task);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

tasksRouter.get("/", async (req, res) => {
  const { from, to, status } = req.query;
  const tasks = await taskService.listTasks({
    from: from ? new Date(String(from)) : undefined,
    to: to ? new Date(String(to)) : undefined,
    status: status ? (String(status) as any) : undefined,
  });
  res.json(tasks);
});

tasksRouter.get("/:id", async (req, res) => {
  try {
    const task = await taskService.getTask(req.params.id);
    res.json(task);
  } catch {
    res.status(404).json({ error: "Task not found" });
  }
});

tasksRouter.post("/:id/start", async (req, res) => {
  try {
    const task = await taskService.startTask(req.params.id);
    res.json(task);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

/**
 * The ONLY way a task can become COMPLETED (spec §10). This route is
 * always principal-initiated — there is no scheduled job or connector
 * anywhere in this codebase that calls taskService.completeTask.
 */
tasksRouter.post("/:id/complete", async (req, res) => {
  try {
    const task = await taskService.completeTask(req.params.id);
    res.json(task);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
