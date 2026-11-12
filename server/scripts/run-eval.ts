/**
 * Runs evals/assistant-cases.json against the real assistant (Claude) on a
 * throwaway database (prisma/eval.db), then reports which cases passed.
 *   npm run eval            all cases
 *   npm run eval -- ta-     only cases whose id starts with "ta-"
 * Needs ANTHROPIC_API_KEY. Costs a few cents per full run.
 */
import { execSync } from "child_process";
import path from "path";
import { readFileSync } from "fs";

process.env.DATABASE_URL = "file:./eval.db";
process.env.ATTACHMENT_STORAGE_PATH = path.join(require("os").tmpdir(), "vp-eval-uploads");

interface InputCheck { localHour?: number; dayOffset?: number; field?: string; pattern?: string }
interface Case {
  id: string; lang: string; mode: "GENERAL" | "EVENING_PLAN" | "MORNING_REPLY"; text: string;
  mustCall?: string[]; mustNotCall?: string[]; inputs?: Record<string, InputCheck>; replyMustNotMatch?: string; why?: string;
}

async function main() {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env"), override: false });
  process.env.DATABASE_URL = "file:./eval.db";
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.log("ANTHROPIC_API_KEY is not set in server/.env — add it, then run: npm run eval");
    process.exit(2);
  }
  execSync("npx prisma migrate deploy", { stdio: "ignore", env: process.env, cwd: path.join(__dirname, "..") });

  const { DateTime } = await import("luxon");
  const { prisma } = await import("../src/db");
  const { runTurn, startConversation } = await import("../src/assistant/agent");
  const { schoolTimezone } = await import("../src/services/morningListService");
  const zone = schoolTimezone();
  const filter = process.argv[2] ?? "";
  const { cases } = JSON.parse(readFileSync(path.join(__dirname, "..", "evals", "assistant-cases.json"), "utf8")) as { cases: Case[] };

  const tables = ["conversationMessage", "conversation", "dayPlanProposal", "dayPlanConfirmation", "attachment", "reminderLog", "reminder",
    "taskHistory", "task", "messageSent", "pendingMessage", "contact", "calendarEvent", "activityLog"] as const;

  async function seed() {
    for (const t of tables) await (prisma as any)[t].deleteMany();
    const today = DateTime.now().setZone(zone).startOf("day");
    const { createTask } = await import("../src/services/taskService");
    for (const [title, h, m] of [["Morning assembly", 8, 30], ["Staff meeting", 11, 0], ["Library visit", 14, 0]] as const) {
      const start = today.set({ hour: h, minute: m });
      await createTask({ title, timeWindowStart: start.toJSDate(), timeWindowEnd: start.plus({ minutes: 30 }).toJSDate() });
    }
    await prisma.contact.createMany({ data: [
      { displayName: "Mr. Raman", email: "raman@example.com" },
      { displayName: "Priya Teacher", email: "priya.t@example.com" },
      { displayName: "Priya Admin", email: "priya.a@example.com" },
      { displayName: "Teachers group", kind: "GROUP" },
      { displayName: "Parents group", kind: "GROUP" },
    ] });
    await prisma.calendarEvent.create({ data: { eventName: "Founders Day", eventDate: today.plus({ days: 6 }).toJSDate(), type: "HOLIDAY" } });
  }

  let passed = 0, run = 0;
  for (const c of cases.filter((x) => x.id.startsWith(filter))) {
    run++;
    await seed();
    const problems: string[] = [];
    let reply = "";
    try {
      const convo = await startConversation(c.mode);
      reply = (await runTurn(convo.id, c.text, "VOICE")).reply;
      const rows = await prisma.conversationMessage.findMany({ where: { conversationId: convo.id, role: "assistant" } });
      const calls = rows.flatMap((r) => { const b = JSON.parse(r.contentJson); return Array.isArray(b) ? b.filter((x: any) => x.type === "tool_use") : []; });
      const names = calls.map((x: any) => x.name);
      for (const t of c.mustCall ?? []) if (!names.includes(t)) problems.push(`did not call ${t}`);
      for (const t of c.mustNotCall ?? []) if (names.includes(t)) problems.push(`called ${t}${c.why ? ` (${c.why})` : ""}`);
      for (const [tool, check] of Object.entries(c.inputs ?? {})) {
        const call = calls.find((x: any) => x.name === tool);
        if (!call) continue;
        if (check.field && check.pattern && !new RegExp(check.pattern, "i").test(String(call.input[check.field] ?? ""))) {
          problems.push(`${tool}.${check.field} = ${JSON.stringify(call.input[check.field])}`);
        }
        const when = call.input.fireAt ?? call.input.start;
        if (when && (check.localHour !== undefined || check.dayOffset !== undefined)) {
          const t = DateTime.fromISO(when, { zone });
          if (check.localHour !== undefined && t.hour !== check.localHour) problems.push(`${tool} time ${t.toFormat("HH:mm")}, expected ${check.localHour}:00`);
          const days = Math.round(t.startOf("day").diff(DateTime.now().setZone(zone).startOf("day"), "days").days);
          if (check.dayOffset !== undefined && days !== check.dayOffset) problems.push(`${tool} day +${days}, expected +${check.dayOffset}`);
        }
      }
      if (c.replyMustNotMatch && new RegExp(c.replyMustNotMatch, "i").test(reply)) problems.push(`reply claims it was sent: "${reply.slice(0, 80)}"`);
      if (!problems.length) passed++;
      console.log(`${problems.length ? "FAIL" : "PASS"}  ${c.id.padEnd(24)} ${c.lang.padEnd(8)} tools: ${names.join(", ") || "none"}`);
    } catch (err) {
      problems.push((err as Error).message);
      console.log(`ERROR ${c.id.padEnd(24)} ${(err as Error).message}`);
    }
    for (const p of problems) console.log(`        - ${p}`);
    if (reply) console.log(`        reply: ${reply.replace(/\s+/g, " ").slice(0, 140)}`);
  }
  console.log(`\n${passed}/${run} cases passed`);
  await prisma.$disconnect();
  process.exit(passed === run ? 0 : 1);
}

main();
