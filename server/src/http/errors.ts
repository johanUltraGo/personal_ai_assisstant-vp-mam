import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { InvalidTransitionError } from "../services/taskService";

export class NotFoundError extends Error {}
export class BadRequestError extends Error {}

/**
 * The one place request errors become HTTP responses. Express 5 forwards
 * rejected promises from async handlers here, so a bad id can never crash
 * the process (which used to stop reminders along with it).
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof NotFoundError) return res.status(404).json({ error: err.message || "Not found" });
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
    return res.status(404).json({ error: "Not found" });
  }
  if (err instanceof ZodError) return res.status(400).json({ error: err.flatten() });
  if (err instanceof BadRequestError || err instanceof InvalidTransitionError) {
    return res.status(400).json({ error: err.message });
  }
  const status = (err as { status?: number; type?: string }).status;
  if (status === 400 || status === 413 || (err as { type?: string }).type === "entity.parse.failed") {
    return res.status(status ?? 400).json({ error: "The request body could not be read." });
  }
  // eslint-disable-next-line no-console
  console.error("[http] unexpected error:", err);
  return res.status(500).json({ error: "Something went wrong" });
}
