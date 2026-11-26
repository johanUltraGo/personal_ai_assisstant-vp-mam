import Anthropic from "@anthropic-ai/sdk";

type Beta = Anthropic.Beta.Messages.BetaMessage;
type BetaParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

/** The slice of the SDK client the assistant uses — lets tests script replies. */
export interface ClaudeLike {
  beta: { messages: { create(params: BetaParams): Promise<Beta> } };
}

export type Effort = "low" | "medium" | "high";

export class MissingApiKeyError extends Error {}

export function claudeModel(): string {
  return process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
}

/** Throws MissingApiKeyError so callers can show a clear "not set up" message. */
export function getClaude(): ClaudeLike {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    throw new MissingApiKeyError(
      "The assistant is not set up yet: ANTHROPIC_API_KEY is missing in server/.env. The forms on this page still work."
    );
  }
  return new Anthropic() as unknown as ClaudeLike;
}

export interface ClaudeCall {
  system: string;
  tools: Anthropic.Beta.Messages.BetaTool[];
  messages: Anthropic.Beta.Messages.BetaMessageParam[];
  effort: Effort;
  /** Overrides ANTHROPIC_MODEL for this request (e.g. a faster model for WhatsApp). */
  model?: string;
}

/**
 * One Messages request with the project's settings (design §3.2):
 * Opus 5.5 by default, effort per conversation kind, server-side refusal
 * fallback, and automatic prompt caching of the stable prefix. Thinking is
 * left at the model default (adaptive) and no sampling parameters are sent.
 */
export function callClaude(client: ClaudeLike, call: ClaudeCall): Promise<Beta> {
  const model = call.model || claudeModel();
  // Haiku has no server-side refusal fallback; send the beta only where it exists.
  const fallback = model.startsWith("claude-haiku") ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };
  return client.beta.messages.create({
    model,
    max_tokens: 16000,
    system: call.system,
    tools: call.tools,
    messages: call.messages,
    output_config: { effort: call.effort },
    cache_control: { type: "ephemeral" },
    ...fallback,
  } as any);
}
