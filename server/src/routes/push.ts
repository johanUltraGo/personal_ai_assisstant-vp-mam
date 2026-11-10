import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";

export const pushRouter = Router();

/** The page needs the VAPID public key to subscribe the phone. */
pushRouter.get("/public-key", (_req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
});

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

pushRouter.post("/subscribe", async (req, res) => {
  const { endpoint, keys } = subscriptionSchema.parse(req.body);
  const saved = await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { endpoint, p256dh: keys.p256dh, auth: keys.auth },
    update: { p256dh: keys.p256dh, auth: keys.auth },
  });
  res.status(201).json({ id: saved.id });
});

pushRouter.post("/unsubscribe", async (req, res) => {
  const { endpoint } = z.object({ endpoint: z.string().url() }).parse(req.body);
  await prisma.pushSubscription.deleteMany({ where: { endpoint } });
  res.json({ ok: true });
});
