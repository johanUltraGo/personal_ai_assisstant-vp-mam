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
  });

  it("logs a BLOCKED result on confirm-send since Gmail has no OAuth client in this environment", async () => {
    const contact = await request(app).post("/api/messaging/contacts").send({ displayName: "Mr. Blocked API", email: "blockedapi@example.com" });
    const prepared = await request(app).post("/api/messaging/prepare").send({
      contactId: contact.body.id,
      channel: "EMAIL",
      body: "Test message",
    });
    const res = await request(app).post("/api/messaging/confirm-send").send(prepared.body);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("BLOCKED");
  });
});
