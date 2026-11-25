import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createHmac } from "crypto";
import { createApp } from "../src/app";

describe("WhatsApp webhook", () => {
  beforeEach(() => {
    process.env.META_WA_VERIFY_TOKEN = "verify-me";
    process.env.META_APP_SECRET = "app-secret";
    process.env.VP_WHATSAPP_NUMBER = "+911234567890";
  });

  it("answers Meta's verification only with the right token", async () => {
    const app = createApp();
    const ok = await request(app).get("/api/whatsapp/webhook").query({ "hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "42" });
    expect(ok.status).toBe(200);
    expect(ok.text).toBe("42");
    const bad = await request(app).get("/api/whatsapp/webhook").query({ "hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "42" });
    expect(bad.status).toBe(403);
  });

  it("refuses unsigned or wrongly signed messages", async () => {
    const app = createApp();
    const body = JSON.stringify({ entry: [] });
    expect((await request(app).post("/api/whatsapp/webhook").set("Content-Type", "application/json").send(body)).status).toBe(401);
    const wrong = "sha256=" + createHmac("sha256", "other").update(body).digest("hex");
    expect((await request(app).post("/api/whatsapp/webhook").set("Content-Type", "application/json").set("X-Hub-Signature-256", wrong).send(body)).status).toBe(401);
  });

  it("accepts a signed message and ignores other people's numbers", async () => {
    const app = createApp();
    const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: "m1", from: "919999999999", type: "text", text: { body: "hi" } }] } }] }] });
    const sig = "sha256=" + createHmac("sha256", "app-secret").update(body).digest("hex");
    const res = await request(app).post("/api/whatsapp/webhook").set("Content-Type", "application/json").set("X-Hub-Signature-256", sig).send(body);
    expect(res.status).toBe(200);
  });
});
