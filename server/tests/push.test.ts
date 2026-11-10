import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { prisma } from "../src/db";
import { createApp } from "../src/app";
import { WebPushNotifier } from "../src/notifiers/webPushNotifier";
import { notifierFromEnvironment, ConsoleNotifier } from "../src/notifiers/notifier";
import * as reminderService from "../src/services/reminderService";

const sub = { endpoint: "https://push.example/abc", keys: { p256dh: "p256", auth: "auth" } };

describe("Web Push notifications", () => {
  afterEach(() => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
  });

  it("stores a phone's subscription once", async () => {
    const app = createApp();
    await request(app).post("/api/push/subscribe").send(sub).expect(201);
    await request(app).post("/api/push/subscribe").send(sub).expect(201);
    expect(await prisma.pushSubscription.count()).toBe(1);
  });

  it("fails when no phone has subscribed, so the reminder retries and then shows as failed", async () => {
    const notifier = new WebPushNotifier(async () => ({ statusCode: 201 }) as any);
    expect(await notifier.send({ title: "t", body: "b" })).toBe(false);
  });

  it("removes a subscription the push service says is gone", async () => {
    await prisma.pushSubscription.create({ data: { endpoint: sub.endpoint, p256dh: "p", auth: "a" } });
    const notifier = new WebPushNotifier(async () => {
      throw Object.assign(new Error("gone"), { statusCode: 410 });
    });
    expect(await notifier.send({ title: "t", body: "b" })).toBe(false);
    expect(await prisma.pushSubscription.count()).toBe(0);
  });

  it("marks a pushed reminder SENT, then DELIVERED when the phone confirms", async () => {
    await prisma.pushSubscription.create({ data: { endpoint: sub.endpoint, p256dh: "p", auth: "a" } });
    const payloads: string[] = [];
    const notifier = new WebPushNotifier(async (_s: any, payload: any) => {
      payloads.push(String(payload));
      return { statusCode: 201 } as any;
    });
    const reminder = await reminderService.createReminder({ label: "Staff meeting", fireAt: new Date(Date.now() - 1000) });
    const fired = await reminderService.fireReminder(reminder.id, notifier);
    expect(fired.status).toBe("SENT");
    expect(JSON.parse(payloads[0]).data.reminderId).toBe(reminder.id);

    const res = await request(createApp()).post(`/api/reminders/${reminder.id}/delivered`);
    expect(res.body.status).toBe("DELIVERED");
    const log = await prisma.reminderLog.findMany({ where: { reminderId: reminder.id }, orderBy: { eventAt: "asc" } });
    expect(log.map((l) => l.eventType)).toEqual(["created", "sent", "delivered"]);
  });

  it("keeps the console notifier when no VAPID keys are set", async () => {
    expect(await notifierFromEnvironment()).toBeInstanceOf(ConsoleNotifier);
    process.env.VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
    expect(await notifierFromEnvironment()).toBeInstanceOf(WebPushNotifier);
  });

  it("publishes the public key for the page", async () => {
    process.env.VAPID_PUBLIC_KEY = "pub-key";
    const res = await request(createApp()).get("/api/push/public-key");
    expect(res.body).toEqual({ publicKey: "pub-key" });
  });
});
