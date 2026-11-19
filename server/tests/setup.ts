import "dotenv/config";
import { beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { schemaOf } from "./testDatabaseUrl";

// Safety net: the tests below delete every table. Never let them near her data.
const url = process.env.DATABASE_URL ?? "";
if (!/^postgres(ql)?:\/\//.test(url) || schemaOf(url) !== "vp_test") {
  throw new Error("Refusing to run tests outside the vp_test schema (see vitest.config.ts).");
}

const TABLES = [
  "ActivityLog", "Session", "PushSubscription", "ConversationMessage", "Conversation", "DayPlanConfirmation", "DayPlanProposal",
  "GoogleAccount", "Attachment", "ReminderLog", "Reminder", "TaskHistory", "Task", "MessageSent", "PendingMessage", "Contact", "CalendarEvent",
];

beforeEach(async () => {
  // One statement instead of one per table: the database is across the internet.
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${TABLES.map((t) => `"vp_test"."${t}"`).join(", ")} CASCADE`);
});

afterAll(async () => {
  await prisma.$disconnect();
});
