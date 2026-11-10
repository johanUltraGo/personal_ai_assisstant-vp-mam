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
