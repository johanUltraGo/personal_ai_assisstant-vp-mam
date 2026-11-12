import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { toolDefinitions } from "../src/assistant/tools";
import "../src/assistant/registerFeatureTools";

describe("assistant test set", () => {
  const { cases } = JSON.parse(readFileSync(path.join(__dirname, "..", "evals", "assistant-cases.json"), "utf8"));
  const tools = new Set(toolDefinitions().map((t) => t.name));

  it("covers Tamil, English and mixed requests in every mode", () => {
    expect(new Set(cases.map((c: any) => c.lang))).toEqual(new Set(["Tamil", "English", "Mixed"]));
    expect(new Set(cases.map((c: any) => c.mode))).toEqual(new Set(["GENERAL", "EVENING_PLAN", "MORNING_REPLY"]));
  });

  it("only names tools the assistant really has, with unique case ids", () => {
    expect(new Set(cases.map((c: any) => c.id)).size).toBe(cases.length);
    for (const c of cases) {
      for (const name of [...(c.mustCall ?? []), ...(c.mustNotCall ?? []), ...Object.keys(c.inputs ?? {})]) {
        expect(tools.has(name), `${c.id}: unknown tool ${name}`).toBe(true);
      }
    }
  });
});
