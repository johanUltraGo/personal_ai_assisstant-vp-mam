import { describe, it, expect, afterEach } from "vitest";
import { callClaude, getClaude, MissingApiKeyError, ClaudeLike } from "../src/ai/claude";

function recordingClient(captured: any[]): ClaudeLike {
  return {
    beta: {
      messages: {
        create: async (params: any) => {
          captured.push(params);
          return { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" } as any;
        },
      },
    },
  };
}

describe("callClaude", () => {
  afterEach(() => {
    delete process.env.ANTHROPIC_MODEL;
  });

  it("uses Opus 5.5 with the chosen effort, refusal fallback and caching", async () => {
    const captured: any[] = [];
    await callClaude(recordingClient(captured), {
      system: "sys",
      tools: [],
      messages: [{ role: "user", content: "hi" }],
      effort: "low",
    });
    const p = captured[0];
    expect(p.model).toBe("claude-opus-5-5");
    expect(p.output_config).toEqual({ effort: "low" });
    expect(p.fallbacks).toBe("default");
    expect(p.betas).toContain("server-side-fallback-2026-07-01");
    expect(p.cache_control).toEqual({ type: "ephemeral" });
    expect(p).not.toHaveProperty("temperature");
    expect(p).not.toHaveProperty("tool_choice");
  });

  it("honours ANTHROPIC_MODEL", async () => {
    process.env.ANTHROPIC_MODEL = "claude-sonnet-5-5";
    const captured: any[] = [];
    await callClaude(recordingClient(captured), { system: "s", tools: [], messages: [{ role: "user", content: "x" }], effort: "medium" });
    expect(captured[0].model).toBe("claude-sonnet-5-5");
  });

  it("refuses to build a client without credentials", () => {
    const saved = { key: process.env.ANTHROPIC_API_KEY, token: process.env.ANTHROPIC_AUTH_TOKEN };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    expect(() => getClaude()).toThrow(MissingApiKeyError);
    if (saved.key) process.env.ANTHROPIC_API_KEY = saved.key;
    if (saved.token) process.env.ANTHROPIC_AUTH_TOKEN = saved.token;
  });
});
