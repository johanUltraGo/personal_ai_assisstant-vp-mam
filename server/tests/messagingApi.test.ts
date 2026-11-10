import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

const app = createApp();

describe("messaging API", () => {
  it("creates a contact and resolves a recipient by name", async () => {
    await request(app).post("/api/messaging/contacts").send({ displayName: "Dr. Kumar", email: "kumar@example.com" });
    const res = await request(app).get("/api/messaging/resolve-recipient").query({ name: "Kumar" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("resolved");
  });

  it("prepares a message without sending it", async () => {
    const contact = await request(app).post("/api/messaging/contacts").send({ displayName: "Mrs. Shanthi", email: "shanthi@example.com" });
    const res = await request(app).post("/api/messaging/prepare").send({
      contactId: contact.body.id,
      channel: "EMAIL",
      subject: "Reminder",
      body: "Please send the attendance sheet.",
    });
    expect(res.status).toBe(200);
    expect(res.body.recipientAddress).toBe("shanthi@example.com");
    expect(res.body.id).toBeTruthy();
  });

  it("sends a prepared message by id and refuses a second send", async () => {
    const contact = await request(app).post("/api/messaging/contacts").send({ displayName: "Mr. Blocked API", email: "blockedapi@example.com" });
    const prepared = await request(app).post("/api/messaging/prepare").send({
      contactId: contact.body.id,
      channel: "EMAIL",
      body: "Test message",
    });
    const res = await request(app).post(`/api/messaging/pending/${prepared.body.id}/send`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("BLOCKED");
    const again = await request(app).post(`/api/messaging/pending/${prepared.body.id}/send`);
    expect(again.status).toBe(400);
    const missing = await request(app).post("/api/messaging/pending/nope/send");
    expect(missing.status).toBe(404);
    const history = await request(app).get("/api/messaging/sent");
    expect(history.body).toHaveLength(1);
  });
});
