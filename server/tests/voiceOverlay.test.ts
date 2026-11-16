import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

describe("voice overlay", () => {
  it("serves the overlay, its styles and script, and the Talk shortcut opens it", async () => {
    const app = createApp();
    const page = await request(app).get("/voice.html");
    expect(page.status).toBe(200);
    expect(page.text).toContain('id="orb"');
    for (const path of ["/voice/voice.css", "/voice/tokens.css", "/voice/base.css", "/js/voice.js"]) {
      expect((await request(app).get(path)).status).toBe(200);
    }
    const manifest = JSON.parse((await request(app).get("/manifest.webmanifest")).text);
    expect(manifest.shortcuts.find((s: any) => s.short_name === "Talk").url).toBe("/voice.html");
    expect((await request(app).get("/")).text).toContain('href="/voice.html"');
  });
});
