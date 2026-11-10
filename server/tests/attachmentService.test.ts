import { describe, expect, it } from "vitest";
import * as taskService from "../src/services/taskService";
import * as attachmentService from "../src/services/attachmentService";

describe("task attachments", () => {
  it("stores a selected file against its chosen task", async () => {
    const task = await taskService.createTask({
      title: "Review circular", timeWindowStart: new Date("2026-11-06T09:00:00Z"), timeWindowEnd: new Date("2026-11-06T09:30:00Z"),
    });
    const saved = await attachmentService.saveTaskAttachment({
      taskId: task.id, originalName: "circular.pdf", mimeType: "application/pdf", content: Buffer.from("sample"),
    });
    expect(saved.originalName).toBe("circular.pdf");
    expect((await attachmentService.listTaskAttachments(task.id)).map((file) => file.id)).toEqual([saved.id]);
  });
});

describe("attachment download and Drive links", () => {
  it("serves an attached file back with its type, and Drive links without a file", async () => {
    const request = (await import("supertest")).default;
    const { createApp } = await import("../src/app");
    const { prisma } = await import("../src/db");
    const app = createApp();
    const task = await prisma.task.create({
      data: { title: "Circular", timeWindowStart: new Date(), timeWindowEnd: new Date(Date.now() + 3600_000), status: "SCHEDULED" },
    });
    const upload = await request(app)
      .post(`/api/attachments?taskId=${task.id}`)
      .set("Content-Type", "image/png")
      .set("X-File-Name", "photo 1.png")
      .send(Buffer.from("png-bytes"));
    expect(upload.status).toBe(201);
    const file = await request(app).get(`/api/attachments/${upload.body.id}/file`).buffer(true);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toContain("image/png");
    expect(Buffer.from(file.body).toString()).toBe("png-bytes");

    const link = await request(app).post("/api/attachments/drive-link").send({ taskId: task.id, url: "https://drive.google.com/file/d/1AbCdEfGhIjK/view" });
    expect(link.status).toBe(201);
    expect(link.body.driveFileId).toBe("1AbCdEfGhIjK");
    expect(link.body.storedName).toBeNull();
    const list = await request(app).get(`/api/attachments?taskId=${task.id}`);
    expect(list.body).toHaveLength(2);
    expect((await request(app).get("/api/attachments/nope/file")).status).toBe(404);
  });
});

describe("attachments cannot run as web pages", () => {
  it("serves HTML and SVG as downloads in a sandbox, photos inline", async () => {
    const request = (await import("supertest")).default;
    const { createApp } = await import("../src/app");
    const { prisma } = await import("../src/db");
    const app = createApp();
    const task = await prisma.task.create({
      data: { title: "x", timeWindowStart: new Date(), timeWindowEnd: new Date(Date.now() + 60_000), status: "SCHEDULED" },
    });
    const upload = (type: string, name: string) =>
      request(app).post(`/api/attachments?taskId=${task.id}`).set("Content-Type", type).set("X-File-Name", name).send(Buffer.from("<script>alert(1)</script>"));
    for (const [type, name] of [["text/html", "a.html"], ["image/svg+xml", "b.svg"]]) {
      const saved = await upload(type, name);
      const res = await request(app).get(`/api/attachments/${saved.body.id}/file`);
      expect(res.headers["content-disposition"]).toMatch(/^attachment/);
      expect(res.headers["content-security-policy"]).toContain("sandbox");
    }
    const photo = await upload("image/png", "c.png");
    const res = await request(app).get(`/api/attachments/${photo.body.id}/file`);
    expect(res.headers["content-disposition"]).toMatch(/^inline/);
    expect(res.headers["content-security-policy"]).toContain("sandbox");
  });
});
