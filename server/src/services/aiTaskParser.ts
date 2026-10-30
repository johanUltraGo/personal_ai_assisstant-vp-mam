import Anthropic from "@anthropic-ai/sdk";

export interface ParsedTaskDraft {
  title: string;
  description?: string;
  category?: string;
  timeWindowStart: string; // ISO 8601
  timeWindowEnd: string; // ISO 8601
}

export type ParseResult =
  | { status: "parsed"; draft: ParsedTaskDraft }
  | { status: "needs_clarification"; question: string };

export class MissingApiKeyError extends Error {}

const TOOL_NAME = "create_task_draft";

const createTaskDraftTool: Anthropic.Tool = {
  name: TOOL_NAME,
  description:
    "Record a single structured task draft parsed from what the Vice Principal said or typed. Only call this when the title and a concrete time window are both clear from her sentence — never guess a time she didn't give.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short task title, in the language she used." },
      description: { type: "string", description: "Any extra detail she gave, optional." },
      category: { type: "string", description: "e.g. teaching, admin, exam duties, events — only if she implied one." },
      timeWindowStart: { type: "string", description: "ISO 8601 datetime for when the task window starts." },
      timeWindowEnd: { type: "string", description: "ISO 8601 datetime for when the task window ends." },
    },
    required: ["title", "timeWindowStart", "timeWindowEnd"],
  },
};

/**
 * Parses one free-text (typed or already-transcribed voice) utterance,
 * in Tamil, English, or a mix of both, into a structured task draft via
 * Claude tool-calling (spec §9: reasoning must be Claude-based).
 *
 * Deliberately does NOT guess when something essential is missing or
 * ambiguous — the system prompt instructs the model to ask a clarifying
 * question instead of calling the tool in that case (planning.md §3.4,
 * flagged there as this plan's design assumption since the spec itself
 * doesn't spell out task-capture ambiguity handling explicitly).
 *
 * Requires ANTHROPIC_API_KEY. Without it, throws MissingApiKeyError
 * rather than fabricating a result — callers must surface that as a
 * clear blocker, not silently succeed.
 */
export async function parseTaskFromText(
  utterance: string,
  opts: { now?: Date; timezone?: string; client?: Anthropic } = {}
): Promise<ParseResult> {
  const client = opts.client ?? createClientFromEnv();
  const now = opts.now ?? new Date();
  const timezone = opts.timezone ?? process.env.SCHOOL_TIMEZONE ?? "Asia/Kolkata";

  const response = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
    max_tokens: 1024,
    system:
      "You are a task-capture assistant for a school Vice Principal in India. " +
      "She speaks Tamil, English, or a mix of both within one sentence, with no " +
      "explicit language marker and no need to choose a language. " +
      `The current date/time is ${now.toISOString()} and her timezone is ${timezone}. ` +
      "Parse her sentence into exactly one task with a concrete time window drawn only " +
      "from what she actually said. If the title or time window is ambiguous or missing, " +
      "do not call the tool — instead reply with a direct clarifying question, in " +
      "whichever language(s) she used.",
    messages: [{ role: "user", content: utterance }],
    tools: [createTaskDraftTool],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === TOOL_NAME
  );
  if (toolUse) {
    return { status: "parsed", draft: toolUse.input as ParsedTaskDraft };
  }

  const text = response.content.find((block): block is Anthropic.TextBlock => block.type === "text");
  return {
    status: "needs_clarification",
    question: text?.text ?? "Could you clarify what you'd like me to schedule, and when?",
  };
}

function createClientFromEnv(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new MissingApiKeyError(
      "AI task parsing is unavailable: ANTHROPIC_API_KEY is not configured. " +
        "Set it in server/.env before using voice/text task parsing."
    );
  }
  return new Anthropic({ apiKey });
}
