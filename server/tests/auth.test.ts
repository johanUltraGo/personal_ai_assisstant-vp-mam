import { describe, it, expect, afterEach, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { resetLoginAttempts } from "../src/http/auth";

describe("access PIN", () => {
  beforeEach(() => resetLoginAttempts());
  afterEach(() => {
    delete process.env.APP_ACCESS_PIN;
  });

  it("requires a session when a PIN is configured", async () => {
    process.env.APP_ACCESS_PIN = "123456";
    const app = createApp();
    expect((await request(app).get("/api/tasks")).status).toBe(401);
    expect((await request(app).post("/api/auth/login").send({ pin: "000000" })).status).toBe(401);

    const ok = await request(app).post("/api/auth/login").send({ pin: "123456" });
    expect(ok.status).toBe(200);
    const cookie = ok.headers["set-cookie"];
    expect(String(cookie)).toContain("vp_session=");
    expect(String(cookie)).toContain("HttpOnly");
    expect((await request(app).get("/api/tasks").set("Cookie", cookie)).status).toBe(200);

    const status = await request(app).get("/api/auth/status").set("Cookie", cookie);
    expect(status.body).toEqual({ pinRequired: true, signedIn: true });
  });

  it("locks out after 5 wrong PINs", async () => {
    process.env.APP_ACCESS_PIN = "123456";
    const app = createApp();
    for (let i = 0; i < 5; i++) await request(app).post("/api/auth/login").send({ pin: "1" });
    const res = await request(app).post("/api/auth/login").send({ pin: "123456" });
    expect(res.status).toBe(429);
  });

  it("without a PIN, refuses proxied requests but allows local ones", async () => {
    const app = createApp();
    expect((await request(app).get("/api/tasks").set("X-Forwarded-For", "1.2.3.4")).status).toBe(401);
    expect((await request(app).get("/api/tasks")).status).toBe(200);
  });

  it("keeps the health check and page open", async () => {
    process.env.APP_ACCESS_PIN = "123456";
    const app = createApp();
    expect((await request(app).get("/health")).status).toBe(200);
    expect((await request(app).get("/")).status).toBe(200);
  });
});
