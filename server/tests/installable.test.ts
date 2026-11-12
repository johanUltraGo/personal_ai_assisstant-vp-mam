import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

describe("installable on her phone", () => {
  it("links a manifest with a name, standalone display and working icons", async () => {
    const app = createApp();
    const page = await request(app).get("/");
    expect(page.text).toContain('rel="manifest"');
    const res = await request(app).get("/manifest.webmanifest");
    expect(res.status).toBe(200);
    const manifest = JSON.parse(res.text);
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    const sizes = manifest.icons.map((i: any) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    for (const icon of manifest.icons) {
      const img = await request(app).get(icon.src);
      expect(img.status).toBe(200);
      expect(img.headers["content-type"]).toContain("image/png");
    }
  });
});
