import { describe, it, expect } from "vitest";
import { parseTaskFromText, MissingApiKeyError } from "../src/services/aiTaskParser";
import type Anthropic from "@anthropic-ai/sdk";

function fakeClient(response: Partial<Anthropic.Message>): Anthropic {
  return {
    messages: {
      create: async () => response as Anthropic.Message,
    },
  } as unknown as Anthropic;
}

describe("aiTaskParser", () => {
  it("throws MissingApiKeyError when no API key and no injected client are available", async () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    await expect(parseTaskFromText("remind me to call the auditor tomorrow")).rejects.toBeInstanceOf(
      MissingApiKeyError
    );
    if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
  });

  it("returns a parsed draft when the model calls the create_task_draft tool", async () => {
    const client = fakeClient({
      content: [
        {
          type: "tool_use",
          id: "tool_1",
          name: "create_task_draft",
          input: {
            title: "Call Mrs. Iyer about fee payment",
            category: "admin",
            timeWindowStart: "2026-10-31T10:00:00+05:30",
            timeWindowEnd: "2026-10-31T10:30:00+05:30",
          },
        },
      ],
    });

    const result = await parseTaskFromText("Mrs Iyer-oda fee payment pathi kaalaila 10 mani call pannanum", { client });
    expect(result.status).toBe("parsed");
    if (result.status === "parsed") {
      expect(result.draft.title).toContain("Mrs. Iyer");
      expect(result.draft.timeWindowStart).toBe("2026-10-31T10:00:00+05:30");
    }
  });

  it("asks a clarifying question instead of guessing when the model doesn't call the tool", async () => {
    const client = fakeClient({
      content: [{ type: "text", text: "When would you like me to schedule that?" }],
    });

    const result = await parseTaskFromText("I need to do something about the exam", { client });
    expect(result.status).toBe("needs_clarification");
    if (result.status === "needs_clarification") {
      expect(result.question).toMatch(/schedule/i);
    }
  });
});
